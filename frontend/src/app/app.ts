import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, ChangeDetectorRef, Component, NgZone, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, TimeoutError, finalize, timeout } from 'rxjs';

type TipoActa = 'nacimiento' | 'inscripcionNacimiento' | 'matrimonio' | 'defuncion' | 'divorcio';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback': () => void;
        'error-callback': () => void;
        theme: 'light' | 'dark' | 'auto';
      }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

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
export class App implements AfterViewInit {
  private readonly http = inject(HttpClient);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly apiUrl = window.location.port === '4200' ? 'https://localhost:7254/api/actas/verificar' : '/verificacion-actas-api/api/actas/verificar';
  private readonly turnstileSiteKey = '0x4AAAAAAFd_7H_2mvrk0jqW';
  private turnstileWidgetId?: string;
  private consultaActa?: Subscription;
  private consultaId = 0;

  identificador = '';
  cadenaActa = '';
  turnstileToken = '';
  turnstileError = '';
  tipoActa: TipoActa = 'nacimiento';
  cargando = false;
  mensajeConsulta = '';
  resultadoActa: Record<string, unknown> | null = null;
  mostrarAvisoCajeros = true;
  notasAbiertas = false;
  transcripcionAbierta = false;
  resolucionAbierta = false;

  get selloPresente(): boolean {
    return this.resultadoActa !== null;
  }

  ngAfterViewInit(): void {
    const renderWidget = () => {
      const widget = window.turnstile;
      const container = document.getElementById('turnstile-widget');
      if (!widget || !container || this.turnstileWidgetId) return;
      this.turnstileWidgetId = widget.render(container, {
        sitekey: this.turnstileSiteKey,
        theme: 'light',
        callback: (token) => this.zone.run(() => {
          this.turnstileToken = token;
          this.turnstileError = '';
          this.changeDetector.markForCheck();
        }),
        'expired-callback': () => this.zone.run(() => {
          this.turnstileToken = '';
          this.turnstileError = 'La verificación expiró. Completa el CAPTCHA nuevamente.';
          this.changeDetector.markForCheck();
        }),
        'error-callback': () => this.zone.run(() => {
          this.turnstileToken = '';
          this.turnstileError = 'No se pudo cargar la verificación. Recarga la página e inténtalo de nuevo.';
          this.changeDetector.markForCheck();
        })
      });
    };

    if (window.turnstile) {
      renderWidget();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = renderWidget;
    script.onerror = () => {
      this.turnstileError = 'No se pudo cargar la verificación. Revisa tu conexión e inténtalo de nuevo.';
      this.changeDetector.markForCheck();
    };
    document.head.appendChild(script);
  }

  get tituloActa(): string {
    if (this.esInscripcionNacimiento) return 'inscripción de nacimiento';
    return ({ nacimiento: 'nacimiento', inscripcionNacimiento: 'inscripción de nacimiento', matrimonio: 'matrimonio', defuncion: 'defunción', divorcio: 'divorcio' } as const)[this.tipoActa];
  }

  get esInscripcionNacimiento(): boolean {
    if (this.tipoActa === 'inscripcionNacimiento') return true;
    if (!this.resultadoActa) return false;
    return Object.entries(this.resultadoActa).some(([nombre, valor]) =>
      /nota|inscrip|transcrip|tipo/i.test(nombre)
      && valor !== null && valor !== undefined
      && /INSCRIPCI|INSCRIB/i.test(String(valor)));
  }

  datoActa(...nombres: string[]): string {
    if (!this.resultadoActa) return '—';
    const entradas = Object.entries(this.resultadoActa);
    for (const nombre of nombres) {
      const entrada = entradas.find(([campo]) => campo.toUpperCase() === nombre.toUpperCase());
      if (entrada && entrada[1] !== null && entrada[1] !== undefined && entrada[1] !== '')
        return this.formatearValor(entrada[1]);
    }
    return '—';
  }

  sexoActa(...nombres: string[]): string {
    const sexo = this.datoActa(...nombres).trim().toLocaleUpperCase('es-MX');
    if (sexo === 'M' || sexo === 'H' || sexo === '1') return 'HOMBRE';
    if (sexo === 'F' || sexo === 'MUJER' || sexo === '2') return 'MUJER';
    return sexo || '—';
  }

  lugarRegistro(): string {
    return [this.datoActa('MUNICIPIO_REG'), this.datoActa('ENTIDAD_REG')]
      .filter((valor) => valor !== '—')
      .join(', ') || '—';
  }

  lugarNacimiento(): string {
    const localidad = this.primerDatoDisponible('LOC_NAC_REG', 'loc_nac_reg_extrangero');
    const municipio = this.primerDatoDisponible('MUN_NAC_REG', 'mun_nac_reg_extrangero');
    const entidad = this.primerDatoDisponible('ENT_NAC_REG', 'ent_nac_reg_extrangero');
    return this.unirValoresUnicos(
      localidad,
      municipio,
      entidad,
      entidad === '—' ? this.primerDatoDisponible('PAIS_NAC_REG', 'pais_nac_reg') : '—'
    );
  }

  lugarNacimientoDefuncion(): string {
    return this.unirValoresUnicos(
      this.datoActa('localidad_nacimiento', 'loc_nac_reg'),
      this.datoActa('municipio_nacimiento', 'mun_nac_reg'),
      this.datoActa('entidad_nacimiento', 'ent_nac_reg')
    );
  }

  lugarDefuncion(): string {
    const domicilio = [
      'domicilio_defuncion_calle', 'domicilio_defuncion_numero_ext',
      'domicilio_defuncion_numero_int', 'domicilio_defuncion_localidad1',
      'domicilio_defuncion_localidad2', 'domicilio_defuncion_municipio1',
      'domicilio_defuncion_municipio2', 'domicilio_defuncion_entidad1',
      'domicilio_defuncion_entidad2', 'domicilio_defuncion_pais'
    ].map((campo) => this.primerDatoDisponible(campo)).filter((valor) => valor !== '—');
    return domicilio.length > 0 ? domicilio.join(', ') : this.primerDatoDisponible(
      'lugar_defuncion', 'lugar_fallecimiento', 'direccion_defuncion',
      'ubicacion_defuncion', 'donde_fallecio'
    );
  }

  lugarNacimientoConyuge(sufijo: 'cty1' | 'cty2'): string {
    const localidad = this.primerDatoDisponible(`loc_nac_${sufijo}`, `loc_nac_${sufijo}_extrangero`);
    const municipio = this.primerDatoDisponible(`mun_nac_${sufijo}`, `mun_nac_${sufijo}_extrangero`);
    const entidad = this.primerDatoDisponible(`ent_nac_${sufijo}`, `ent_nac_${sufijo}_extrangero`);
    const pais = this.primerDatoDisponible(`pais_nac_${sufijo}`);
    return [localidad, municipio, entidad, pais !== 'MEXICO' ? pais : '—']
      .filter((valor) => valor !== '—').join(', ') || '—';
  }

  edadConyuge(sufijo: 'cty1' | 'cty2'): string {
    const edad = this.datoActa(`edad_${sufijo}`);
    return edad === '—' ? edad : edad.split(',')[0].trim();
  }

  get hayNotas(): boolean {
    const notas = this.textoNotasCompleto;
    return notas !== '—' && notas.trim().length > 0;
  }

  get textoNotas(): string {
    return this.resumir(this.textoNotasCompleto, 155);
  }

  get textoNotasCompleto(): string {
    const notas = this.primerDatoDisponible('notas_marginales');
    if (notas !== '—') return notas;
    return this.esInscripcionNacimiento ? this.textoTranscripcion : '—';
  }

  get textoInscripcion(): string {
    const texto = this.datoActa('inscripcion', 'texto_inscripcion', 'transcripcion_inscripcion', 'transcripcion', 'TRANSCRIPCION');
    return texto === '—' ? 'La vista de datos no incluye el texto completo de la inscripción.' : texto;
  }

  get textoTranscripcion(): string {
    const texto = this.datoActa('transcripcion', 'TRANSCRIPCION', 'texto_transcripcion', 'inscripcion', 'texto_inscripcion');
    return texto === '—' ? 'La vista de datos no incluye una transcripción.' : texto;
  }

  get vistaPreviaTranscripcion(): string {
    return this.resumir(this.textoTranscripcion, 185);
  }

  get textoViaDisolucion(): string {
    return this.datoActa('resolucion_admva', 'via_disolucion');
  }

  get vistaPreviaViaDisolucion(): string {
    return this.textoViaDisolucion === '—' ? '—' : this.textoViaDisolucion.replace(/\s+/g, ' ').trim().slice(0, 32);
  }

  cambiarTipoActa(): void {
    this.mensajeConsulta = '';
    this.resultadoActa = null;
    this.changeDetector.markForCheck();
  }

  cerrarAvisoCajeros(): void {
    this.mostrarAvisoCajeros = false;
    this.changeDetector.markForCheck();
  }

  buscar(event: Event): void {
    event.preventDefault();
    if (this.cargando) return;
    if (!this.turnstileToken) {
      this.turnstileError = 'Completa la verificación para continuar.';
      return;
    }

    this.consultaActa?.unsubscribe();
    const consultaId = ++this.consultaId;
    this.mensajeConsulta = '';
    this.resultadoActa = null;
    this.cargando = true;

    this.consultaActa = this.http.post<VerificarActaResponse>(this.apiUrl, {
      identificador: this.identificador.trim().toUpperCase(),
      cadenaActa: this.cadenaActa.trim(),
      turnstileToken: this.turnstileToken
    }).pipe(
      timeout({ first: 20000 }),
      finalize(() => {
        if (consultaId === this.consultaId) {
          this.cargando = false;
          this.turnstileToken = '';
          window.turnstile?.reset(this.turnstileWidgetId);
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
    this.turnstileToken = '';
    this.turnstileError = '';
    window.turnstile?.reset(this.turnstileWidgetId);
    this.cargando = false;
    this.mensajeConsulta = '';
    this.resultadoActa = null;
    this.changeDetector.markForCheck();
  }

  private formatearValor(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'string') return this.formatearFecha(value);
    if (value instanceof Date) return this.formatearFecha(value.toISOString());
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private formatearFecha(value: string): string {
    const match = value.match(/^(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[/-](\d{1,2})[/-](\d{4}))(?:$|T|\s)/);
    if (!match) return value;
    const year = Number(match[1] ?? match[6]);
    const month = Number(match[2] ?? match[5]);
    const day = Number(match[3] ?? match[4]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return value;
    const monthName = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'][month - 1];
    return `${String(day).padStart(2, '0')} DE ${monthName} DE ${year}`;
  }

  private unirValoresUnicos(...valores: string[]): string {
    const vistos = new Set<string>();
    return valores
      .filter((valor) => valor !== '—' && valor.trim().length > 0)
      .filter((valor) => {
        const clave = valor.trim().replace(/\\s+/g, ' ').toLocaleUpperCase('es-MX');
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      })
      .join(', ') || '—';
  }

  private primerDatoDisponible(...nombres: string[]): string {
    for (const nombre of nombres) {
      const valor = this.datoActa(nombre);
      if (valor !== '—' && valor.trim().length > 0) return valor;
    }
    return '—';
  }

  private resumir(texto: string, maximo: number): string {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    return limpio.length > maximo ? `${limpio.slice(0, maximo - 3).trimEnd()}…` : limpio;
  }
}
