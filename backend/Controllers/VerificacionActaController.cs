using System.Text.RegularExpressions;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;

namespace backend.Controllers;

[ApiController]
[Route("api/actas")]
public sealed class VerificacionActaController(
    MySqlDataSource dataSource,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    ILogger<VerificacionActaController> logger) : ControllerBase
{
    private static readonly Regex IdentifierPattern = new("^[A-Za-z]{2}[0-9]{1,9}$", RegexOptions.Compiled);
    private static readonly Regex FolioPattern = new("^[0-9]{20}$", RegexOptions.Compiled);

    private static readonly IReadOnlyDictionary<string, string> Queries = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["nacimiento"] = "SELECT * FROM `sirabiproject`.`v_acta_nacimiento_v1` WHERE GUID = @guid AND folio = @folio AND sello IS NOT NULL LIMIT 1",
        ["matrimonio"] = "SELECT * FROM `sirabiproject`.`v_acta_matrimonio_v1` WHERE GUID = @guid AND folio = @folio AND sello IS NOT NULL LIMIT 1",
        ["defuncion"] = "SELECT * FROM `sirabiproject`.`v_acta_defuncion_v1` WHERE GUID = @guid AND folio = @folio AND sello IS NOT NULL LIMIT 1",
        ["divorcio"] = "SELECT * FROM `sirabiproject`.`v_acta_divorcio_v1` WHERE GUID = @guid AND folio = @folio AND sello IS NOT NULL LIMIT 1"
    };

    [HttpPost("verificar")]
    [EnableRateLimiting("ConsultaActas")]
    public async Task<IActionResult> Verificar([FromBody] VerificarActaRequest request, CancellationToken cancellationToken)
    {
        if (request is null || !IdentifierPattern.IsMatch(request.Identificador ?? "")
            || !FolioPattern.IsMatch(request.CadenaActa ?? ""))
            return BadRequest(new { mensaje = "Los datos de búsqueda no tienen un formato válido." });

        var secretKey = configuration["Turnstile:SecretKey"];
        if (string.IsNullOrWhiteSpace(secretKey))
        {
            logger.LogError("No está configurada la clave secreta de Cloudflare Turnstile.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { mensaje = "La verificación de seguridad no está configurada." });
        }

        if (string.IsNullOrWhiteSpace(request.TurnstileToken))
            return BadRequest(new { mensaje = "Completa la verificación de seguridad." });

        try
        {
            using var response = await httpClientFactory.CreateClient().PostAsync(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["secret"] = secretKey,
                    ["response"] = request.TurnstileToken,
                    ["remoteip"] = HttpContext.Connection.RemoteIpAddress?.ToString() ?? ""
                }),
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Cloudflare Turnstile respondió con estado HTTP {StatusCode}.", response.StatusCode);
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { mensaje = "No se pudo validar la verificación de seguridad." });
            }

            var validation = await response.Content.ReadFromJsonAsync<TurnstileValidation>(cancellationToken);
            if (validation?.Success != true)
                return BadRequest(new { mensaje = "La verificación expiró o no fue válida. Inténtalo nuevamente." });
        }
        catch (HttpRequestException exception)
        {
            logger.LogError(exception, "No fue posible validar el token con Cloudflare Turnstile.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { mensaje = "No se pudo validar la verificación de seguridad." });
        }

        // Las dos primeras letras identifican dirección/cajero; el sufijo de 1-9 dígitos es el GUID.
        var guid = request.Identificador![2..];
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            foreach (var (tipoActa, sql) in Queries)
            {
                await using var command = new MySqlCommand(sql, connection);
                command.Parameters.AddWithValue("@guid", guid);
                command.Parameters.AddWithValue("@folio", request.CadenaActa);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) continue;

                var acta = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < reader.FieldCount; i++)
                    acta[reader.GetName(i)] = await reader.IsDBNullAsync(i, cancellationToken) ? null : reader.GetValue(i);

                // Las inscripciones están incluidas en la vista de nacimiento;
                // se distinguen por la anotación que identifica el trámite.
                var tipoEncontrado = tipoActa;
                if (tipoEncontrado == "nacimiento" && EsInscripcionNacimiento(acta))
                {
                    tipoEncontrado = "inscripcionNacimiento";
                }

                return Ok(new { tipoActa = tipoEncontrado, acta });
            }

            return NotFound(new { mensaje = "No se encontró un acta que coincida con los datos proporcionados." });
        }
        catch (MySqlException exception)
        {
            logger.LogError(exception, "Falló la consulta de verificación de actas MySQL.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { mensaje = "No fue posible consultar el servicio de actas.", detail = "Intenta nuevamente más tarde." });
        }
    }

    private static bool EsInscripcionNacimiento(IReadOnlyDictionary<string, object?> acta)
    {
        return acta.Any(campo =>
            (campo.Key.Contains("nota", StringComparison.OrdinalIgnoreCase)
                || campo.Key.Contains("transcrip", StringComparison.OrdinalIgnoreCase)
                || campo.Key.Contains("inscrip", StringComparison.OrdinalIgnoreCase)
                || campo.Key.Contains("tipo", StringComparison.OrdinalIgnoreCase))
            && campo.Value is not null
            && (campo.Value.ToString()!.Contains("INSCRIPCI", StringComparison.OrdinalIgnoreCase)
                || campo.Value.ToString()!.Contains("INSCRIB", StringComparison.OrdinalIgnoreCase)));
    }
}

public sealed record VerificarActaRequest(string? Identificador, string? CadenaActa, string? TurnstileToken);
public sealed record TurnstileValidation(bool Success);
