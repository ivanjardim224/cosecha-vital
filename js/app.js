const URL_TASA_BCV = 'https://ve.dolarapi.com/v1/dolares/oficial';
const INTERVALO_ACTUALIZACION_BCV = 24 * 60 * 60 * 1000;
const CLAVE_PEDIDO_GUARDADO = 'cosecha-vital-pedido-v1';
const totalPrecio = document.getElementById('total-precio');
const totalBs = document.getElementById('total-bs');
const estadoTasa = document.getElementById('estado-tasa');
const botonPedido = document.getElementById('enviar-pedido');
const productos = Array.from(document.querySelectorAll('[data-producto]')).map(tarjeta => ({
    nombre: tarjeta.dataset.producto,
    precioPor100: Number(tarjeta.dataset.precio),
    tarjeta,
    input: tarjeta.querySelector('.gramos-producto'),
    subtotal: tarjeta.querySelector('.subtotal-usd'),
    precioBs: tarjeta.querySelector('.precio-bs-100'),
    subtotalBs: tarjeta.querySelector('.subtotal-bs'),
    botonAgregar: tarjeta.querySelector('.add-to-order'),
    confirmacionAgregar: tarjeta.querySelector('.add-feedback'),
    gramos: 0,
    gramosEnPedido: 0,
    cantidadValida: true,
    subtotalUSD: 0,
    subtotalPedidoUSD: 0
}));
const listaPedido = document.getElementById('lista-pedido');
const contadorPedido = document.getElementById('contador-pedido');
const contadorCarritoSuperior = document.getElementById('contador-carrito-superior');
const enlaceCarrito = document.getElementById('enlace-carrito');
const botonVaciarPedido = document.getElementById('vaciar-pedido');
let tasaBCV = null;
let fechaTasaBCV = null;
let ultimaConsultaBCV = 0;
let consultaBCVEnCurso = false;
let totalPedidoUSD = 0;

function formatoNumero(numero, decimales) {
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
    }).format(numero);
}

function formatoFecha(fecha) {
    return new Intl.DateTimeFormat('es-VE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Caracas'
    }).format(fecha);
}

function guardarPedido() {
    const pedido = productos
        .filter(producto => producto.gramosEnPedido > 0)
        .map(producto => ({ nombre: producto.nombre, gramos: producto.gramosEnPedido }));

    try {
        localStorage.setItem(CLAVE_PEDIDO_GUARDADO, JSON.stringify(pedido));
    } catch (error) {
        console.error('No se pudo guardar el carrito en este navegador:', error);
    }
}

function restaurarPedido() {
    let contenidoGuardado;
    try {
        contenidoGuardado = localStorage.getItem(CLAVE_PEDIDO_GUARDADO);
    } catch (error) {
        console.error('No se pudo leer el carrito guardado:', error);
        return;
    }

    if (contenidoGuardado === null) return;

    let pedidoGuardado;
    try {
        pedidoGuardado = JSON.parse(contenidoGuardado);
    } catch (error) {
        console.error('El carrito guardado no contiene datos válidos:', error);
        return;
    }

    if (!Array.isArray(pedidoGuardado)) {
        console.error('El formato del carrito guardado no es válido.');
        return;
    }

    const cantidadesGuardadas = new Map();
    for (const elemento of pedidoGuardado) {
        if (!elemento ||
            typeof elemento.nombre !== 'string' ||
            !Number.isSafeInteger(elemento.gramos) ||
            elemento.gramos <= 0) {
            console.error('El carrito guardado contiene un producto o cantidad no válidos.');
            return;
        }
        cantidadesGuardadas.set(elemento.nombre, elemento.gramos);
    }

    productos.forEach(producto => {
        producto.gramosEnPedido = cantidadesGuardadas.get(producto.nombre) || 0;
    });
}

function actualizarResumenPedido() {
    const seleccionados = productos.filter(producto => producto.gramosEnPedido > 0);
    listaPedido.textContent = '';
    contadorPedido.textContent = `${seleccionados.length} ${seleccionados.length === 1 ? 'producto' : 'productos'}`;
    contadorCarritoSuperior.textContent = String(seleccionados.length);
    enlaceCarrito.setAttribute(
        'aria-label',
        `Abrir mi carrito: ${seleccionados.length} ${seleccionados.length === 1 ? 'producto' : 'productos'}`
    );
    botonVaciarPedido.disabled = seleccionados.length === 0;

    if (seleccionados.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'cart-empty';
        vacio.textContent = 'Aún no has agregado productos. Elige una cantidad para empezar.';
        listaPedido.appendChild(vacio);
        return;
    }

    seleccionados.forEach(producto => {
        const fila = document.createElement('li');
        fila.className = 'order-item';

        const detalle = document.createElement('div');
        const nombre = document.createElement('strong');
        nombre.className = 'order-item-name';
        nombre.textContent = producto.nombre;
        const cantidad = document.createElement('span');
        cantidad.className = 'order-item-quantity';
        cantidad.textContent = `${producto.gramosEnPedido} g · $${formatoNumero(producto.precioPor100, 2)} por 100 g`;
        detalle.append(nombre, cantidad);

        const precios = document.createElement('div');
        precios.className = 'order-item-prices';
        const dolares = document.createElement('strong');
        dolares.textContent = `$${producto.subtotalPedidoUSD.toFixed(2)}`;
        const bolivares = document.createElement('span');
        bolivares.textContent = `Bs. ${tasaBCV ? formatoNumero(producto.subtotalPedidoUSD * tasaBCV.valor, 2) : '—'}`;
        precios.append(dolares, bolivares);

        const acciones = document.createElement('div');
        acciones.className = 'order-item-actions';
        const quitar = document.createElement('button');
        quitar.className = 'remove-order-item';
        quitar.type = 'button';
        quitar.textContent = 'Quitar';
        quitar.setAttribute('aria-label', `Quitar ${producto.nombre} del pedido`);
        quitar.addEventListener('click', () => {
            producto.gramosEnPedido = 0;
            guardarPedido();
            calcularPrecio();
        });
        acciones.appendChild(quitar);

        fila.append(detalle, precios, acciones);
        listaPedido.appendChild(fila);
    });
}

function calcularPrecio() {
    let totalPedidoSinRedondear = 0;

    productos.forEach(producto => {
        const valor = producto.input.value.trim();
        const gramos = valor === '' ? 0 : Number(valor);
        producto.cantidadValida = Number.isFinite(gramos) &&
            gramos >= 0 &&
            Number.isInteger(gramos);
        producto.input.setCustomValidity(producto.cantidadValida
            ? ''
            : 'Ingresa una cantidad válida en gramos enteros.');
        producto.gramos = gramos;
        producto.subtotalUSD = producto.cantidadValida
            ? Number((gramos * producto.precioPor100 / 100).toFixed(2))
            : 0;
        producto.subtotal.textContent = producto.subtotalUSD.toFixed(2);
        producto.botonAgregar.disabled = !producto.cantidadValida || gramos <= 0;
        producto.precioBs.textContent = tasaBCV
            ? formatoNumero(producto.precioPor100 * tasaBCV.valor, 2)
            : '—';
        producto.subtotalBs.textContent = tasaBCV && producto.cantidadValida
            ? formatoNumero(producto.subtotalUSD * tasaBCV.valor, 2)
            : '—';

        producto.subtotalPedidoUSD = Number((producto.gramosEnPedido * producto.precioPor100 / 100).toFixed(2));
        totalPedidoSinRedondear += producto.subtotalPedidoUSD;
    });

    totalPedidoUSD = Number(totalPedidoSinRedondear.toFixed(2));
    const hayProductosEnPedido = productos.some(producto => producto.gramosEnPedido > 0);
    botonPedido.disabled = !hayProductosEnPedido;
    totalPrecio.textContent = totalPedidoUSD.toFixed(2);
    totalBs.textContent = tasaBCV
        ? formatoNumero(totalPedidoUSD * tasaBCV.valor, 2)
        : '—';
    actualizarResumenPedido();
}

async function actualizarTasaBCV() {
    if (consultaBCVEnCurso) return;
    consultaBCVEnCurso = true;
    ultimaConsultaBCV = Date.now();
    estadoTasa.textContent = 'Consultando la tasa oficial BCV...';

    try {
        const respuesta = await fetch(URL_TASA_BCV, { cache: 'no-store' });
        if (!respuesta.ok) {
            throw new Error(`El servicio de tasa respondió con HTTP ${respuesta.status}.`);
        }

        const datos = await respuesta.json();
        const valor = Number(datos.promedio);
        const fecha = new Date(datos.fechaActualizacion);
        if (datos.fuente !== 'oficial' ||
            !Number.isFinite(valor) ||
            valor <= 0 ||
            !Number.isFinite(fecha.getTime())) {
            throw new Error('El servicio devolvió datos de tasa no válidos.');
        }

        tasaBCV = { valor };
        fechaTasaBCV = fecha;
        estadoTasa.textContent = `Tasa oficial publicada el ${formatoFecha(fecha)}: Bs. ${formatoNumero(valor, 4)} por USD.`;
        calcularPrecio();
    } catch (error) {
        tasaBCV = null;
        fechaTasaBCV = null;
        estadoTasa.textContent = 'No se pudo consultar la tasa BCV. Actualiza la página o confirma el monto en bolívares por WhatsApp.';
        calcularPrecio();
        console.error('Error al consultar la tasa oficial BCV:', error);
    } finally {
        consultaBCVEnCurso = false;
    }
}

function enviarPedido() {
    calcularPrecio();
    const productosSeleccionados = productos.filter(producto => producto.gramosEnPedido > 0);
    if (productosSeleccionados.length === 0) {
        alert('Agrega al menos un producto a tu pedido antes de enviarlo.');
        return;
    }

    const total = totalPedidoUSD.toFixed(2);
    const lineasMensaje = [
        'Hola Cosecha Vital 🌾, me gustaría hacer un pedido:',
        ''
    ];
    productosSeleccionados.forEach(producto => {
        const equivalenteBs = tasaBCV
            ? ` · Bs. ${formatoNumero(producto.subtotalPedidoUSD * tasaBCV.valor, 2)}`
            : '';
        lineasMensaje.push(`- ${producto.nombre}: ${producto.gramosEnPedido} g · $${producto.subtotalPedidoUSD.toFixed(2)}${equivalenteBs}`);
    });
    lineasMensaje.push(`*Total estimado:* $${total}`);

    if (tasaBCV && fechaTasaBCV) {
        const totalBolivares = Number(total) * tasaBCV.valor;
        lineasMensaje.push(
            `*Equivalente en bolívares:* Bs. ${formatoNumero(totalBolivares, 2)}`,
            `*Tasa oficial BCV:* Bs. ${formatoNumero(tasaBCV.valor, 4)} por USD`,
            `*Fecha de la tasa:* ${formatoFecha(fechaTasaBCV)}`
        );
    } else {
        lineasMensaje.push('No se pudo consultar la tasa BCV; por favor confirmen el monto en bolívares.');
    }

    lineasMensaje.push('', 'Por favor, confírmenme el pedido y los métodos de pago.');
    const mensaje = lineasMensaje.join('\n');
    const telefono = '584241590006';
    const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

restaurarPedido();
productos.forEach(producto => {
    producto.input.addEventListener('input', () => {
        producto.confirmacionAgregar.textContent = '';
        calcularPrecio();
    });
    producto.tarjeta.querySelectorAll('.quantity-step').forEach(boton => {
        boton.addEventListener('click', () => {
            const gramosActuales = Number(producto.input.value) || 0;
            const ajuste = Number(boton.dataset.ajuste);
            producto.input.value = String(Math.max(0, gramosActuales + ajuste));
            producto.input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
    producto.botonAgregar.addEventListener('click', () => {
        calcularPrecio();
        if (!producto.cantidadValida) {
            producto.input.reportValidity();
            return;
        }
        if (producto.gramos <= 0) return;

        const gramosAgregados = producto.gramos;
        producto.gramosEnPedido += gramosAgregados;
        guardarPedido();
        producto.input.value = '0';
        producto.confirmacionAgregar.textContent = `${gramosAgregados} g agregados al pedido.`;
        calcularPrecio();
    });
});
botonVaciarPedido.addEventListener('click', () => {
    productos.forEach(producto => {
        producto.input.value = '0';
        producto.gramosEnPedido = 0;
        producto.confirmacionAgregar.textContent = '';
    });
    guardarPedido();
    calcularPrecio();
});
botonPedido.addEventListener('click', enviarPedido);
calcularPrecio();
actualizarTasaBCV();
window.setInterval(actualizarTasaBCV, INTERVALO_ACTUALIZACION_BCV);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - ultimaConsultaBCV >= INTERVALO_ACTUALIZACION_BCV) {
        actualizarTasaBCV();
    }
});
