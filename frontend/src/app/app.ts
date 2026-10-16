import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, TimeoutError, finalize, timeout } from 'rxjs';

type TipoActa = 'nacimiento' | 'matrimonio' | 'defuncion' | 'divorcio';

interface VerificarActaResponse {
  tipoActa: TipoActa;
  acta: Record<string, unknown>;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.html'
})
export class App {
  private readonly http = inject(HttpClient);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly apiUrl = 'https://localhost:7254/api/actas/verificar';
  private consultaActa?: Subscription;
  private consultaId = 0;

  identificador = '';
  cadenaActa = '';
  codigoVerificacion = '';
  tipoActa: TipoActa = 'nacimiento';
  cargando = false;
  mensajeConsulta = '';
  resultadoActa: Record<string, unknown> | null = null;
  notasAbiertas = false;

  get selloPresente(): boolean {
    return this.resultadoActa !== null;
  }

  get tituloActa(): string {
    return ({ nacimiento: 'nacimiento', matrimonio: 'matrimonio', defuncion: 'defunción', divorcio: 'divorcio' } as const)[this.tipoActa];
  }

  datoActa(...nombres: string[]): string {
    if (!this.resultadoActa) return '—';
    const buscado = new Set(nombres.map((nombre) => nombre.toUpperCase()));
    const entrada = Object.entries(this.resultadoActa)
      .find(([nombre]) => buscado.has(nombre.toUpperCase()));
    return entrada ? this.formatearValor(entrada[1]) : '—';
  }

  lugarRegistro(): string {
    return [this.datoActa('MUNICIPIO_REG'), this.datoActa('ENTIDAD_REG')]
      .filter((valor) => valor !== '—')
      .join(', ') || '—';
  }

  lugarNacimiento(): string {
    return [this.datoActa('LOC_NAC_REG'), this.datoActa('MUN_NAC_REG'), this.datoActa('ENT_NAC_REG')]
      .filter((valor) => valor !== '—')
      .join(', ') || '—';
  }

  lugarNacimientoConyuge(sufijo: 'cty1' | 'cty2'): string {
    return [this.datoActa(`loc_nac_${sufijo}`), this.datoActa(`mun_nac_${sufijo}`), this.datoActa(`ent_nac_${sufijo}`)]
      .filter((valor) => valor !== '—').join(', ') || '—';
  }

  get hayNotas(): boolean {
    const notas = this.datoActa('notas_marginales');
    return notas !== '—' && notas.trim().length > 0;
  }

  cambiarTipoActa(): void {
    this.mensajeConsulta = '';
    this.resultadoActa = null;
    this.changeDetector.markForCheck();
  }

  buscar(event: Event): void {
    event.preventDefault();
    if (this.cargando) return;

    this.consultaActa?.unsubscribe();
    const consultaId = ++this.consultaId;
    this.mensajeConsulta = '';
    this.resultadoActa = null;
    this.cargando = true;

    this.consultaActa = this.http.post<VerificarActaResponse>(this.apiUrl, {
      identificador: this.identificador.trim().toUpperCase(),
      cadenaActa: this.cadenaActa.trim()
    }).pipe(
      timeout({ first: 20000 }),
      finalize(() => {
        if (consultaId === this.consultaId) {
          this.cargando = false;
          this.changeDetector.markForCheck();
        }
      })
    ).subscribe({
      next: (response) => {
        if (consultaId !== this.consultaId) return;
        this.tipoActa = response.tipoActa;
        this.resultadoActa = response.acta;
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        if (consultaId !== this.consultaId) return;
        this.mensajeConsulta = error instanceof TimeoutError
          ? 'La consulta tardó demasiado. Verifica que el backend esté iniciado y que pueda conectarse a la base de datos.'
          : error.status === 404
          ? 'No se encontró un acta que coincida con los datos proporcionados.'
          : error.status === 429
            ? 'Se alcanzó el límite temporal de consultas. Espera un momento e inténtalo de nuevo.'
            : error.status === 0
              ? 'No fue posible comunicarse con el servicio de verificación.'
              : error.status === 503
                ? 'El servicio de actas no está disponible por el momento.'
                : 'No se pudo completar la consulta. Revisa los datos e inténtalo nuevamente.';
        this.changeDetector.markForCheck();
      }
    });
  }

  cancelar(): void {
    this.consultaId++;
    this.consultaActa?.unsubscribe();
    this.consultaActa = undefined;
    this.identificador = '';
    this.cadenaActa = '';
    this.codigoVerificacion = '';
    this.cargando = false;
    this.mensajeConsulta = '';
    this.resultadoActa = null;
    this.changeDetector.markForCheck();
  }

  private formatearValor(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
