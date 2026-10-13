using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
[Route("api/actas")]
public sealed class VerificacionActaController : ControllerBase
{
    [HttpPost("verificar")]
    [ProducesResponseType(StatusCodes.Status501NotImplemented)]
    public IActionResult Verificar()
    {
        return Problem(
            statusCode: StatusCodes.Status501NotImplemented,
            title: "Servicio en preparación",
            detail: "La verificación se habilitará cuando se integre la fuente oficial de datos.");
    }
}
