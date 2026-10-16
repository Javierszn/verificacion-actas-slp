using System.Threading.RateLimiting;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

var connectionString = builder.Configuration.GetConnectionString("Actas")
    ?? throw new InvalidOperationException(
        "No está configurada la conexión a la base de actas.");

builder.Services.AddMySqlDataSource(connectionString);

// Permite la llamada desde Angular local. Agregar el dominio oficial
// cuando Infraestructura entregue el host de producción.
builder.Services.AddCors(options => options.AddPolicy("FrontendLocal", policy =>
    policy.WithOrigins("http://localhost:4200")
        .AllowAnyHeader()
        .AllowAnyMethod()));

// Mitiga consultas repetidas desde un mismo origen. El CAPTCHA real
// también deberá validarse en el servidor antes de publicar el servicio.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("ConsultaActas", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseCors("FrontendLocal");
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers();

app.Run();
