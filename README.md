# Verificación de Actas SLP

Proyecto independiente para consultar actas de nacimiento expedidas en San Luis Potosí.

## Estructura

- `frontend/`: Angular 22.
- `backend/`: API ASP.NET Core sobre .NET 10.

## Ejecutar en desarrollo

En una terminal:

```powershell
cd frontend
npm start
```

Abre `http://localhost:4200`.

En otra terminal, si quieres iniciar la API:

```powershell
cd backend
dotnet run
```

## Estado

La pantalla muestra el formulario de consulta y el espacio donde aparecerá el acta. El botón de búsqueda solo muestra un aviso de que el servicio está en preparación; todavía no consulta la base de datos. La API responde `501 Not Implemented` hasta que se integre la fuente oficial. El CAPTCHA que se ve en pantalla es solo una maqueta visual y aún no valida intentos.

Para conectar el servicio necesitaremos el esquema o API autorizada de actas, las reglas de validación de identificador y cadena, y los requisitos aprobados de seguridad y privacidad. No uses datos reales mientras no esté conectada la fuente oficial.
