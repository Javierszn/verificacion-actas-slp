import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.html'
})
export class App {
  identificador = '';
  cadenaActa = '';
  codigoVerificacion = '';
  cargando = false;
  mensajeConsulta = '';

  buscar(event: Event): void {
    event.preventDefault();
    this.mensajeConsulta = '';
    this.cargando = true;

    window.setTimeout(() => {
      this.cargando = false;
      this.mensajeConsulta = 'La búsqueda todavía no consulta registros: falta conectar la base oficial de actas.';
    }, 700);
  }

  cancelar(): void {
    this.identificador = '';
    this.cadenaActa = '';
    this.codigoVerificacion = '';
    this.cargando = false;
    this.mensajeConsulta = '';
  }
}
