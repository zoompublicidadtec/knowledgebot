<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manual de la Base de Conocimiento · KnowledgeBot — Zoom Publicidad</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #2563eb; --primary-dark: #1d4ed8; --accent: #10b981;
      --bg: #0b0f19; --card-bg: #151d2a; --text-main: #f8fafc; --text-muted: #94a3b8;
      --border: #263346; --highlight: #f59e0b; --danger: #ef4444; --ok: #22c55e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background-color: var(--bg); color: var(--text-main); line-height: 1.65; padding: 20px; }
    .container { max-width: 1000px; margin: 0 auto; }

    .topbar { position: sticky; top: 0; z-index: 50; background: rgba(11,15,25,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); padding: 10px 16px; margin: -20px -20px 22px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .topbar .home-btn { background: #1e293b; border: 1px solid var(--border); color: #cbd5e1; padding: 7px 14px; border-radius: 9px; cursor: pointer; font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
    .topbar .home-btn:hover { background: #28374d; color: #fff; }
    .topbar .crumb { color: #94a3b8; font-size: 0.9rem; font-weight: 600; flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topbar .crumb b { color: #fff; }
    .progress-wrap { display: flex; align-items: center; gap: 10px; min-width: 180px; }
    .progress-bar { flex: 1; height: 8px; background: #1e293b; border-radius: 99px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), #60a5fa); width: 0%; transition: width 0.3s ease; border-radius: 99px; }
    .progress-wrap .pct { color: #94a3b8; font-size: 0.82rem; font-variant-numeric: tabular-nums; min-width: 38px; text-align: right; }

    .screen { display: none; animation: fadeIn 0.25s ease; }
    .screen.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .header { text-align: center; padding: 30px 30px 24px; background: var(--card-bg); border-radius: 16px; border: 1px solid var(--border); margin-bottom: 24px; }
    .header h1 { font-size: 2rem; font-weight: 800; color: #fff; }
    .header .sub { font-size: 1.05rem; color: var(--text-muted); margin-top: 8px; }
    .header .meta { font-size: 0.85rem; color: var(--text-muted); margin-top: 14px; }

    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-top: 8px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 22px 20px; cursor: pointer; transition: all 0.18s ease; display: flex; flex-direction: column; gap: 8px; text-align: left; font-family: inherit; color: inherit; }
    .card:hover { border-color: var(--primary); transform: translateY(-3px); box-shadow: 0 10px 26px rgba(37,99,235,0.18); }
    .card .cicon { font-size: 1.9rem; }
    .card .ctitle { font-size: 1.08rem; font-weight: 700; color: #fff; }
    .card .cdesc { font-size: 0.88rem; color: var(--text-muted); line-height: 1.45; }
    .card .cnum { font-size: 0.75rem; color: #60a5fa; font-weight: 700; letter-spacing: 0.5px; }

    .step-card { background: var(--card-bg); border-radius: 16px; padding: 32px; border: 1px solid var(--border); }
    .step-header { display: flex; align-items: center; gap: 14px; font-size: 1.5rem; font-weight: 800; color: #fff; margin-bottom: 6px; }
    .step-num { background: var(--primary); color: #fff; min-width: 42px; height: 42px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 1.18rem; font-weight: 800; }
    .step-intro { color: var(--text-muted); margin: 8px 0 20px; font-size: 1rem; }
    .step-card h2 { font-size: 1.5rem; font-weight: 800; color: #fff; }
    .step-card h3 { color: #38bdf8; font-size: 1.2rem; margin: 26px 0 12px; }

    p { margin: 10px 0; }
    ol.steps, ul.steps { margin: 12px 0 12px 24px; }
    ol.steps li, ul.steps li { margin: 9px 0; }

    .img-box { text-align: center; background: #090d16; padding: 14px; border-radius: 14px; border: 1px solid var(--border); margin: 18px 0; }
    .img-box img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.45); }
    .img-caption { font-size: 0.87rem; color: var(--text-muted); margin-top: 10px; font-style: italic; }

    .field { background: #0f172a; border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; margin: 14px 0; }
    .field .fname { color: #60a5fa; font-weight: 700; font-size: 1.02rem; }
    .field .fdesc { margin-top: 4px; }
    .code { color: #f1f5f9; font-family: ui-monospace, Consolas, monospace; background: #1e293b; padding: 2px 7px; border-radius: 4px; font-size: 0.92em; }
    .example { color: var(--accent); }

    .callout { border-radius: 12px; padding: 16px 18px; margin: 16px 0; border-left: 5px solid; font-size: 0.97rem; }
    .callout .ctitle { font-weight: 800; display: block; margin-bottom: 4px; }
    .tip    { background: rgba(34,197,94,0.10); border-color: var(--ok); }
    .rule   { background: rgba(245,158,11,0.12); border-color: var(--highlight); }
    .warn   { background: rgba(239,68,68,0.10); border-color: var(--danger); }
    .info   { background: rgba(37,99,235,0.12); border-color: var(--primary); }
    .why    { background: rgba(96,165,250,0.08); border-color: #60a5fa; }

    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.92rem; }
    th, td { border: 1px solid var(--border); padding: 9px 11px; text-align: left; }
    th { background: #1e293b; color: #fff; font-weight: 600; }
    td { color: #e2e8f0; }
    tr:nth-child(even) td { background: #111a28; }

    .legend { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 10px 0 20px; }
    .badge { font-size: 0.78rem; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); }
    .b-on  { background: rgba(37,99,235,0.18); color: #93c5fd; }
    .b-off { background: rgba(100,116,139,0.18); color: #cbd5e1; }

    .nav-buttons { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--border); }
    .nav-btn { background: #1e293b; border: 1px solid var(--border); color: #e2e8f0; padding: 13px 22px; border-radius: 12px; cursor: pointer; font-size: 0.95rem; font-weight: 600; transition: all 0.16s ease; font-family: inherit; }
    .nav-btn:hover:not(:disabled) { background: var(--primary); border-color: var(--primary); color: #fff; }
    .nav-btn.next { margin-left: auto; }

    footer { text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
  </style>
</head>
<body>
<div class="container">

  <!-- BARRA SUPERIOR FIJA -->
  <div class="topbar">
    <button class="home-btn" onclick="goHome()">🏠 Inicio</button>
    <div class="crumb" id="crumb">Inicio</div>
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
      <span class="pct" id="progressPct">0%</span>
    </div>
  </div>

  <!-- ===================== PANTALLA INICIO ===================== -->
  <div class="screen active" id="screen-home">
    <div class="header">
      <h1>📘 Manual de la Base de Conocimiento</h1>
      <div class="sub">Cómo crear, editar y cargar productos para que el bot de WhatsApp cotice bien</div>
      <div class="meta">KnowledgeBot · Zoom Publicidad · Panel <span class="code">zoompublicidad.tech/conocimiento</span></div>
    </div>
    <p style="text-align:center; color:var(--text-muted); margin-bottom:20px;">
      Toca una tarjeta para empezar. Puedes seguir el orden o saltar al tema que necesites.
    </p>
    <div class="cards-grid">
      <button class="card" onclick="goTo('hojas')"><span class="cnum">HOJAS</span><span class="cicon">📋</span><span class="ctitle">Hojas de categoría</span><span class="cdesc">Cómo se le explica al bot la forma de vender cada familia de productos.</span></button>
      <button class="card" onclick="goTo('p0')"><span class="cnum">PASO 0</span><span class="cicon">🧭</span><span class="ctitle">Antes de empezar</span><span class="cdesc">Qué es esto y por qué importa. 2 minutos que te ahorran horas.</span></button>
      <button class="card" onclick="goTo('p1')"><span class="cnum">PASO 1</span><span class="cicon">🔑</span><span class="ctitle">Ingresar al panel</span><span class="cdesc">Cómo entrar a la pantalla donde se administran los productos.</span></button>
      <button class="card" onclick="goTo('p2')"><span class="cnum">PASO 2</span><span class="cicon">📁</span><span class="ctitle">Categorías y sinónimos</span><span class="cdesc">Lo primero que se crea. Ningún producto puede quedar suelto.</span></button>
      <button class="card" onclick="goTo('p3')"><span class="cnum">PASO 3</span><span class="cicon">➕</span><span class="ctitle">Crear un producto</span><span class="cdesc">La ficha campo por campo: datos, imagen, precios. El paso central.</span></button>
      <button class="card" onclick="goTo('p4')"><span class="cnum">PASO 4</span><span class="cicon">✏️</span><span class="ctitle">Editar, pausar y eliminar</span><span class="cdesc">Mantener el catálogo al día cuando cambian precios o stock.</span></button>
      <button class="card" onclick="goTo('p5')"><span class="cnum">PASO 5</span><span class="cicon">📊</span><span class="ctitle">Carga masiva por Excel</span><span class="cdesc">Para crear o actualizar muchos productos de una sola vez.</span></button>
      <button class="card" onclick="goTo('p6')"><span class="cnum">PASO 6</span><span class="cicon">💳</span><span class="ctitle">Reglas del negocio</span><span class="cdesc">Pago, entrega y garantía: dónde se configuran (no es aquí).</span></button>
      <button class="card" onclick="goTo('anexo')"><span class="cnum">ANEXO</span><span class="cicon">📑</span><span class="ctitle">Glosario y Precios</span><span class="cdesc">Las otras dos pestañas del panel: jerga y marcación.</span></button>
      <button class="card" onclick="goTo('faq')"><span class="cnum">AYUDA</span><span class="cicon">❓</span><span class="ctitle">Preguntas frecuentes</span><span class="cdesc">Lo que más suele pasar y cómo resolverlo, paso a paso.</span></button>
    </div>
    <footer style="margin-top:28px;">Manual de la Base de Conocimiento · KnowledgeBot · Zoom Publicidad</footer>
  </div>

  <!-- ===================== HOJAS DE CATEGORÍA ===================== -->
  <div class="screen" id="screen-hojas"><section class="step-card">
    <div class="step-header"><span class="step-num">H</span> Hojas de categoría</div>
    <p class="step-intro">Dónde se le explica al bot cómo se vende cada familia de productos. Es la pestaña que más cambia lo que el cliente recibe.</p>

    <h3>¿Qué es una hoja?</h3>
    <p>Una hoja es la <strong>ficha de instrucciones de una familia de productos</strong>. En ella se escribe cuatro cosas:
    cómo llama el cliente a esos productos, con qué palabra están guardados en su lista, qué hace falta saber para poder
    dar un precio, y qué puede afirmar el bot sin tener que consultarlo con usted.</p>
    <p>El catálogo dice <em>qué vende</em> y <em>a qué precio</em>. La hoja dice <em>cómo se vende</em>.
    Son dos cosas distintas y viven en pestañas distintas.</p>

    <div class="callout why">
      <span class="ctitle">🤖 Por qué el bot la necesita</span>
      El bot busca en su lista con las palabras que usted escribió en el catálogo. El cliente, en cambio, escribe con
      las suyas. Un cliente que pide un <strong>«timbre»</strong> quiere un sello — pero en la lista no existe ningún
      producto llamado «timbre», así que el bot le ofrecía un <strong>Timbre Bike</strong>, que es un timbre de
      bicicleta. La hoja es lo que traduce «timbre» a «sello» antes de buscar.
    </div>

    <h3>Cuándo hacer una hoja nueva y cuándo no</h3>
    <p>Las hojas <strong>no se agrupan por lo que el producto es, sino por cómo se cotiza</strong>. La pregunta que hay
    que hacerse es una sola: <em>«¿a estos productos les pregunto lo mismo antes de dar un precio?»</em></p>
    <table>
      <tr><th>Caso</th><th>¿Una hoja o dos?</th><th>Por qué</th></tr>
      <tr><td>Mug y termo</td><td><strong>Una sola</strong></td><td>A los dos se les pregunta lo mismo: cuántos y qué logo lleva.</td></tr>
      <tr><td>Gorra y camiseta</td><td><strong>Dos</strong></td><td>A la camiseta hay que preguntarle las tallas; a la gorra no.</td></tr>
      <tr><td>Cuaderno y libreta</td><td><strong>Dos</strong></td><td>El cuaderno se arma por partes (hojas, argollado, insertos); la libreta tiene un precio y ya.</td></tr>
      <tr><td>Sello, fechador y numerador</td><td><strong>Una sola</strong></td><td>A los tres se les pregunta el tamaño y si lleva fecha.</td></tr>
    </table>
    <div class="callout tip">
      <span class="ctitle">💡 Regla corta</span>
      Si a dos productos les hace <strong>las mismas preguntas</strong>, van en la misma hoja. Si a uno le pregunta algo
      que al otro no, van en hojas separadas.
    </div>

    <h3>Cómo se abre una hoja</h3>
    <ol class="steps">
      <li>Entre a <strong>«Base de Conocimiento»</strong> y arriba elija la pestaña <strong>«Hojas de categoría»</strong>.</li>
      <li>Cada hoja es <strong>un renglón</strong>: su número, su nombre, cuánto le falta por llenar y a cuántos productos llega.</li>
      <li><strong>Haga clic en el renglón</strong> y la hoja se abre. Al abrir una, la anterior se cierra sola: siempre hay una a la vista, nunca quince encimadas.</li>
      <li>Cuando termine, pulse <strong>«Guardar hojas»</strong>. Hasta que no lo pulse, <strong>nada se guarda</strong>: si se equivocó, recargue la página y todo vuelve como estaba.</li>
    </ol>
    <div class="callout info">
      <span class="ctitle">🔢 El número del renglón: 12/12</span>
      Al lado del nombre hay un número como <span class="code">12/12</span>. Son los doce campos de la hoja y cuántos
      tiene escritos. En <span style="color:var(--ok)"><strong>verde</strong></span> está completa, en
      <span style="color:var(--highlight)"><strong>amarillo</strong></span> va a medias y en
      <span style="color:var(--danger)"><strong>rojo</strong></span> solo tiene el vocabulario.
      Así sabe cuál le falta sin abrir ninguna.
    </div>

    <h3>Campo por campo</h3>
    <p>Vamos con los doce campos, con un ejemplo real de su propio catálogo en cada uno. El ejemplo es la
    <strong>hoja de Sellos</strong>, que cubre 105 productos.</p>

    <div class="field">
      <div class="fname">1. ¿Cómo quiere llamar a esta hoja?</div>
      <div class="fdesc">Una etiqueta suya, para reconocerla en la lista. <strong>El bot no la lee.</strong>
      <span class="example">Ej.: Sellos.</span></div>
    </div>

    <div class="field">
      <div class="fname">2. ¿Para qué productos sirve esta hoja?</div>
      <div class="fdesc">Marque los grupos del catálogo que se venden preguntando lo mismo. Al lado de cada grupo va
      el número de productos que tiene: si dice <span class="code">0</span>, ese grupo está vacío y marcarlo no sirve de nada.
      <span class="example">Ej.: Sellos (63) · Sellos - Cuadrados/Redondos (14) · Sellos - Rectangulares (15).</span></div>
    </div>

    <div class="field">
      <div class="fname">3. ¿Cómo lo pide el cliente, con sus propias palabras? <span style="color:var(--danger)">★ el más importante</span></div>
      <div class="fdesc">Todas las formas en que un cliente puede nombrar esa familia, <strong>separadas por comas</strong> y
      con los plurales incluidos. Es lo que hace que el bot entienda a quien no habla como usted.
      <span class="example">Ej.: sello, sellos, sellito, sellitos, timbre, timbres, sellado.</span>
      <br><strong>Escriba también los plurales y las formas conjugadas.</strong> Un cliente escribió
      «mugs que cambien de color» y la hoja decía «mug que cambia de color»: no coincidió por una letra, y el bot
      ofreció el producto equivocado.</div>
    </div>

    <div class="field">
      <div class="fname">4. ¿Con qué nombre lo tiene guardado usted?</div>
      <div class="fdesc">La palabra que <strong>sí existe</strong> en su pestaña «Catálogo de Productos». Cuando el
      cliente use cualquiera de las palabras del campo 3, el bot buscará con esta.
      <span class="example">Ej.: sello.</span>
      <br>Ponga <strong>una sola palabra</strong>, la más corta que distinga la familia. Si pone una frase larga,
      el bot pierde el resto de lo que dijo el cliente.</div>
    </div>

    <div class="field">
      <div class="fname">5. Palabras que el cliente usa y usted NO tiene guardadas</div>
      <div class="fdesc">Palabras que no aparecen en el nombre de ningún producto suyo. El bot las quita de la
      búsqueda para no buscarlas en vano.
      <span class="example">Ej.: en la hoja de Cuadernos, «agenda» — porque en su lista no existe ninguna agenda.</span>
      <br><strong>Úselo poco.</strong> Cada palabra que quita es una palabra menos para acertar. Déjelo vacío si duda.</div>
    </div>

    <div class="field">
      <div class="fname">6. ¿Qué necesita saber usted para poder dar un precio?</div>
      <div class="fdesc">Los datos sin los cuales usted tampoco podría cotizar.
      <span class="example">Ej.: el tamaño, solo si el cliente no lo dijo ya · si lo quiere con fecha.</span>
      <br><strong>Cuidado con este campo: todo lo que escriba aquí se convierte en una pregunta que frena la venta.</strong>
      Cuando decía «cuántos», a «quiero un sello con fecha» el bot contestaba «¿cuántos sellos necesitas?» y se quedaba
      sin dar precio. Al quitarlo, cotiza por unidad y sigue. <strong>Escriba solo lo imprescindible.</strong></div>
    </div>

    <div class="field">
      <div class="fname">7. ¿Y cómo se lo pregunta a un cliente?</div>
      <div class="fdesc">Escríbalo tal como se lo diría por WhatsApp. El cliente no sabe qué es un troquel ni una tinta
      directa. Si empieza con «solo si…», el bot solo pregunta cuando de verdad falta el dato.
      <span class="example">Ej.: Solo si no te dijo el tamaño: pásame el texto o el logo que va a llevar el sello y dime de qué tamaño lo necesitas; con el texto yo te digo cuál te sirve. Y cuéntame si lo quieres con fecha.</span></div>
    </div>

    <div class="field">
      <div class="fname">8. ¿Hay algo que NO haga falta preguntar?</div>
      <div class="fdesc">Lo que usted ya da por hecho. Sirve para que el bot no interrogue al cliente por cosas que ya sabe.
      <span class="example">Ej.: no preguntes cuántos para dar el precio: cotiza por unidad y sigue. Si el cliente ya dio la medida (10x8, 4 cm, 42x42mm) cotiza con esa. Si no pide fecha, es un sello sin fechador.</span></div>
    </div>

    <div class="field">
      <div class="fname">9. ¿Qué extras se le pueden agregar?</div>
      <div class="fdesc">Cosas que se suman al precio y que usted ya tiene cargadas con su valor en el catálogo.
      <span class="example">Ej.: almohadilla, tinta, repuesto.</span>
      <br>El bot <strong>no los enumera por su cuenta</strong>: solo los menciona si el cliente pregunta por agregar algo.</div>
    </div>

    <div class="field">
      <div class="fname">10. Lo que se imprime en el producto, ¿ya va en el precio?</div>
      <div class="fdesc">Cuatro opciones, y cada una cambia lo que el bot responde:
      <table>
        <tr><th>Lo que elija</th><th>Lo que hace el bot</th></tr>
        <tr><td>Sí, ya está incluido</td><td>Confirma que sí le ponen su logo y <strong>sigue cotizando</strong>, sin preguntar nada técnico.</td></tr>
        <tr><td>No, se cobra aparte</td><td>Avisa que la marcación se cotiza por separado.</td></tr>
        <tr><td>A estos productos no se les imprime nada</td><td>Dice que ese producto no se personaliza.</td></tr>
        <tr><td>No sé / depende</td><td><strong>No afirma nada</strong> y ofrece consultarlo con el equipo.</td></tr>
      </table>
      Si no está seguro, deje «No sé / depende». <strong>Vale más que consulte a que invente.</strong></div>
    </div>

    <div class="field">
      <div class="fname">11. ¿Algo más sobre lo que se imprime?</div>
      <div class="fdesc">Una aclaración corta, si hace falta.
      <span class="example">Ej.: en la hoja de Cuadernos, «el diseño ya está en la lista de extras: no hay que preguntar técnica ni tintas».</span></div>
    </div>

    <div class="field">
      <div class="fname">12. ¿Algo más que deba saber quien atienda?</div>
      <div class="fdesc">Mínimos, medidas, cosas que cuestan aparte. Escríbalo como se lo diría a un empleado nuevo.
      <span class="example">Ej.: Mínimo 20 unidades. Medida estándar hasta 6 x 4 cm; más grande tiene un costo adicional que se confirma con producción.</span></div>
    </div>

    <h3>Los dos campos del cierre: qué ofrecer de más</h3>
    <p>Al final de la hoja hay dos campos que trabajan juntos. Sirven para que, <strong>una vez cerrada la venta</strong>,
    el bot ofrezca una sola cosa más — con el precio ya calculado.</p>
    <div class="field">
      <div class="fname">Qué producto ofrecer al cerrar</div>
      <div class="fdesc">Escriba el nombre y <strong>elíjalo de la lista que aparece</strong>. No lo escriba a mano: el
      panel guarda la referencia para que no haya dudas de cuál es.
      <span class="example">Ej.: en la hoja de Sellos, «Tinta 28ml» (ZM-S-61/65).</span></div>
    </div>
    <div class="field">
      <div class="fname">Con qué frase se lo ofrece</div>
      <div class="fdesc">La frase, en sus palabras. Donde vaya una cifra, escriba una de estas cuatro y el sistema la
      rellena solo:
      <table>
        <tr><th>Si escribe</th><th>El bot pone</th></tr>
        <tr><td><span class="code">{precio}</span></td><td>El precio de una unidad.</td></tr>
        <tr><td><span class="code">{total}</span></td><td>El precio de todas las unidades juntas.</td></tr>
        <tr><td><span class="code">{cantidad}</span></td><td>Cuántas unidades compró el cliente.</td></tr>
        <tr><td><span class="code">{producto}</span></td><td>El nombre del producto que se ofrece.</td></tr>
      </table>
      <span class="example">Ej.: «Una cosa más: te sumo {cantidad} {producto} de repuesto por {total}, para que el sello no se te quede sin tinta. ¿Te sirve?»</span></div>
    </div>
    <div class="callout rule">
      <span class="ctitle">⚠️ Sin frase escrita, no hay oferta</span>
      La frase tiene que llevar <span class="code">{precio}</span> o <span class="code">{total}</span>. Si no lleva
      ninguna de las dos, el bot <strong>no ofrece nada</strong>: una oferta sin precio obliga al cliente a preguntar,
      y preguntar en el cierre reabre una venta que ya estaba hecha.
    </div>

    <h3>Lo que NO hay que poner en la hoja</h3>
    <div class="callout warn">
      <span class="ctitle">🚫 Los precios por cantidad</span>
      Los descuentos por volumen —«12 pad mouse a $18.200 cada uno, 30 a $12.350»— <strong>no van aquí</strong>.
      Ya están cargados en cada producto, en sus rangos de precio, y el bot los ofrece solo. Copiarlos a la hoja
      sería escribir a mano miles de cifras que quedarían mintiendo el día que cambie un precio.
    </div>

    <h3>Cómo saber si la hoja está funcionando</h3>
    <ol class="steps">
      <li><strong>Los tres números de arriba.</strong> Cuántas hojas tiene, qué porcentaje de sus productos reconoce el bot, y cuántas hojas están a medio llenar. El porcentaje es el que hay que subir.</li>
      <li><strong>Los botones amarillos.</strong> Son las palabras que el bot todavía no reconoce, con cuántos productos deja fuera cada una. Haga clic en una y le queda la hoja creada, con el vocabulario ya puesto.</li>
      <li><strong>El aviso rojo de palabras repetidas.</strong> Si la misma palabra está en dos hojas, el bot usa una sola y descarta la otra sin avisar. Manda la que esté más arriba en la lista.</li>
      <li><strong>Pruébelo.</strong> Escríbale al bot como le escribiría un cliente y mire qué contesta. Los cambios de una hoja tardan <strong>un minuto</strong> en aplicarse.</li>
    </ol>

    <h3>Los tres errores que ya se cometieron</h3>
    <div class="callout warn">
      <span class="ctitle">1. Dejar el vocabulario en singular</span>
      «mug que cambia de color» no coincide con «mugs que cambien de color». Escriba <strong>todas las formas</strong>:
      singular, plural y como lo diría un cliente apurado.
    </div>
    <div class="callout warn">
      <span class="ctitle">2. Poner dos hojas sobre el mismo grupo de productos</span>
      El bot usa una sola y <strong>tira la otra sin decir nada</strong>. Si el panel le muestra el aviso naranja de
      «dos hojas para los mismos productos», quítele el grupo a una de las dos.
    </div>
    <div class="callout warn">
      <span class="ctitle">3. Llenar solo el vocabulario y dejar el resto vacío</span>
      Es el más común: <strong>once de las doce primeras hojas estaban así</strong>. Con solo el vocabulario, el bot
      encuentra el producto pero no sabe qué preguntar ni qué puede afirmar. El renglón lo delata: dice
      <span class="code">2/12</span> en rojo.
    </div>

    <div class="callout tip">
      <span class="ctitle">💡 Si no sabe por dónde empezar</span>
      Abra una hoja que ya funcione, pulse <strong>«Duplicar»</strong> y cámbiele lo que difiera. La copia nace arriba
      con todo escrito, así no tiene que llenar una hoja en blanco mirando al techo.
    </div>

    <div class="nav-buttons"><button class="nav-btn" onclick="goHome()">🏠 Inicio</button><button class="nav-btn next" onclick="goTo('p0')">Siguiente: Antes de empezar →</button></div>
  </section></div>

  <!-- ===================== PASO 0 ===================== -->
  <div class="screen" id="screen-p0"><section class="step-card">
    <div class="step-header"><span class="step-num">0</span> Antes de empezar</div>
    <p class="step-intro">Entender esto te ahorra horas. Son 2 minutos que valen oro.</p>
    <h3>¿Qué es la "Base de Conocimiento"?</h3>
    <p>Es el catálogo de productos y precios que usa <strong>el bot de WhatsApp</strong> para responder a los clientes.
    Lo que tú cargues aquí es lo único que el bot "sabe" que vendes. Si un producto no está aquí,
    el bot no lo puede ofrecer. Si está mal cargado, el bot cotiza mal.</p>
    <div class="callout why">
      <span class="ctitle">🤖 Lo que el bot ve vs. lo que ves tú</span>
      Tú ves una tabla bonita. El bot, en cambio, usa tres cosas de cada producto para trabajar:
      <strong>(1) el nombre + la ficha técnica + los sinónimos</strong> para <em>encontrar</em> el producto cuando
      el cliente lo nombra (aunque lo diga con otra palabra), <strong>(2) los rangos de precio</strong> para
      <em>cotizar</em>, y <strong>(3) el interruptor "Activo"</strong> para saber si puede o no ofrecerlo.
      Llenar bien esos tres puntos es el 90% del trabajo.
    </div>
    <div class="callout rule">
      <span class="ctitle">⚠️ Regla de oro nº 1</span>
      El bot <strong>nunca inventa precios</strong>. Si un producto no tiene precio cargado, el bot simplemente
      <strong>no lo ofrece como propuesta</strong> al cliente. Por eso es clave cargar precios correctos en cada producto.
    </div>
    <p>En este manual usaremos como ejemplo un producto real: el <strong>"Aviso Caja de Luz para Fachada"</strong>
    (referencia <span class="code">ZM-AVI-001</span>). Pero el mismo procedimiento sirve para <em>cualquier</em> producto del negocio.</p>
    <div class="nav-buttons"><button class="nav-btn" onclick="goHome()">🏠 Inicio</button><button class="nav-btn next" onclick="goTo('p1')">Siguiente: Ingresar al panel →</button></div>
  </section></div>

  <!-- ===================== PASO 1 ===================== -->
  <div class="screen" id="screen-p1"><section class="step-card">
    <div class="step-header"><span class="step-num">1</span> Ingresar al panel</div>
    <p class="step-intro">Cómo entrar a la pantalla donde se administran los productos.</p>
    <ol class="steps">
      <li>Abre en el navegador: <span class="code">https://zoompublicidad.tech/login</span></li>
      <li>Escribe tu <strong>correo</strong> y tu <strong>contraseña</strong> (los que te asignaron).</li>
      <li>Pulsa el botón <span class="code">Ingresar</span>.</li>
      <li>En el menú izquierdo, haz clic en <strong>«Base de Conocimiento»</strong> (ícono de libro).</li>
    </ol>
    <div class="img-box">
      <img src="{{IMG:manual-01-login}}" alt="Pantalla de ingreso al panel con los campos de correo y contraseña y el botón Ingresar">
      <div class="img-caption">Pantalla de ingreso. Escribe tus credenciales y pulsa «Ingresar».</div>
    </div>
    <div class="callout info">
      <span class="ctitle">🔐 Sobre las credenciales</span>
      Usa el usuario y la contraseña que te asignaron. Si no los tienes o los olvidaste, pídelos al administrador.
      Por seguridad, no compartas estas claves por chats públicos.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p0')">← Anterior</button><button class="nav-btn next" onclick="goTo('p2')">Siguiente: Categorías →</button></div>
  </section></div>

  <!-- ===================== PASO 2 ===================== -->
  <div class="screen" id="screen-p2"><section class="step-card">
    <div class="step-header"><span class="step-num">2</span> Categorías (lo primero que se crea)</div>
    <p class="step-intro">Ningún producto puede quedar "suelto". Todo producto pertenece a una categoría.</p>
    <h3>2.1  Ver las categorías existentes</h3>
    <p>A la izquierda verás el <strong>árbol de categorías</strong>. Antes de crear una nueva, búscala ahí
    (puedes desplazar la lista). En Zoom hay más de 80 categorías; lo más probable es que la que necesites ya exista.</p>
    <div class="img-box">
      <img src="{{IMG:manual-02c-arbol-categorias}}" alt="Árbol de categorías en el panel izquierdo con la lista de categorías existentes">
      <div class="img-caption">El árbol de categorías a la izquierda. Aquí buscas si la categoría ya existe.</div>
    </div>
    <h3>2.2  Crear una categoría nueva</h3>
    <p>Si la categoría no existe, créala así:</p>
    <ol class="steps">
      <li>Arriba del árbol, pulsa el botón <strong>«Nueva»</strong> (ícono de carpeta).</li>
      <li>Se abre la ventana <strong>«Crear Nueva Categoría»</strong>.</li>
      <li>Escribe el <strong>Nombre</strong> (ej.: <span class="example">Avisos y Publicidad Exterior</span>).</li>
      <li>Opcional: escribe un <strong>Agrupador</strong> superior (ej.: <span class="example">Exterior / Señalética</span>).</li>
      <li>Pulsa <strong>«Crear»</strong>.</li>
    </ol>
    <div class="img-box">
      <img src="{{IMG:manual-05-crear-categoria}}" alt="Ventana Crear Nueva Categoría con los campos Nombre y Agrupador y los botones Cancelar y Crear">
      <div class="img-caption">Ventana «Crear Nueva Categoría». Solo el Nombre es obligatorio.</div>
    </div>
    <h3>2.3  Sinónimos de categoría (¡muy importante para el bot!)</h3>
    <p>Los <strong>sinónimos globales de categoría</strong> son las palabras que el bot asocia con TODA una categoría.
    Si los llenas bien, cuando un cliente escriba "letrero", "valla", "caja de luz" o "anuncio", el bot entenderá
    que se refiere a productos de esa categoría.</p>
    <p>Cómo editarlos:</p>
    <ol class="steps">
      <li>En el árbol, busca la categoría.</li>
      <li>Pasa el mouse sobre ella y pulsa el botón <strong>«Más acciones»</strong> (los tres puntitos <strong>⋮</strong>).</li>
      <li>Elige <strong>«Sinónimos»</strong>.</li>
      <li>Se abre la ventana <strong>«Sinónimos Globales»</strong>. Escribe todas las palabras con las que un
      cliente podría nombrar esa categoría, <strong>separadas por comas</strong>.</li>
      <li>Pulsa <strong>«Guardar y Aplicar»</strong>.</li>
    </ol>
    <div class="img-box">
      <img src="{{IMG:manual-06-sinonimos-globales}}" alt="Ventana de Sinónimos Globales de una categoría con el campo Lista de Sinónimos">
      <div class="img-caption">Sinónimos globales de categoría. Estas palabras aplican a TODOS los productos de la categoría.</div>
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 Truco Pro</span>
      Piensa en cómo habla <em>el cliente</em>, no en cómo habla el negocio. Si vendes "letreros" pero el cliente
      pregunta por "el cartel del local" o "la valla", pon todas esas palabras.
    </div>
    <div class="callout warn">
      <span class="ctitle">❌ Cuidado al eliminar una categoría</span>
      Si borras una categoría que tiene productos, el panel te pregunta qué hacer con ellos: dejarlos
      <em>sin categoría</em> o <em>reasignarlos</em> a otra. Revisa bien antes de confirmar.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p1')">← Anterior</button><button class="nav-btn next" onclick="goTo('p3')">Siguiente: Crear producto →</button></div>
  </section></div>

  <!-- ===================== PASO 3 ===================== -->
  <div class="screen" id="screen-p3"><section class="step-card">
    <div class="step-header"><span class="step-num">3</span> Crear un producto (ficha campo por campo)</div>
    <p class="step-intro">Ejemplo real: «Aviso Caja de Luz para Fachada» (ZM-AVI-001). Sirve para cualquier producto.</p>

    <div class="callout rule">
      <span class="ctitle">⚠️ Regla de oro nº 0 — El orden de los pasos</span>
      Crear un producto con foto se hace <strong>en 2 tiempos</strong>, no todo de golpe:
      <ol style="margin:8px 0 0 22px">
        <li><strong>Primero llenas la ficha y GUARDAS.</strong> Así el producto queda creado en el sistema.</li>
        <li><strong>Después subes la foto.</strong> El botón de subir imagen <em>no funciona</em> hasta que guardas.</li>
      </ol>
      <strong>¿Por qué?</strong> La foto no es solo decoración: es lo que le enseña al bot <em>cómo se ve</em> el producto
      (la "conexión inteligente"). El sistema genera esa conexión <strong>automáticamente al subir la foto</strong>.
      Sin foto, el bot solo encuentra el producto si el cliente nombra palabras muy parecidas al nombre; con foto, lo
      reconoce mucho mejor. Por eso el orden es siempre: <strong>Guardar → Subir foto</strong>.
    </div>

    <ol class="steps">
      <li>Arriba a la derecha pulsa el botón <strong>«Agregar Producto»</strong> (ícono de +).</li>
      <li>Se abre un <strong>panel lateral</strong> desde la derecha con el título «Crear Nuevo Producto».</li>
    </ol>
    <div class="img-box">
      <img src="{{IMG:manual-03-drawer-vacio}}" alt="Panel lateral Crear Nuevo Producto recién abierto con los campos vacíos">
      <div class="img-caption">El panel lateral «Crear Nuevo Producto» recién abierto, con todos los campos vacíos.</div>
    </div>
    <p>El formulario tiene <strong>4 bloques</strong>. Vamos uno por uno.</p>

    <!-- BLOQUE 1 -->
    <h3>Bloque 1 · Datos básicos</h3>
    <div class="field">
      <div class="fname">1. Nombre comercial <span style="color:var(--danger)">*</span> <span style="color:var(--text-muted);font-weight:400">(obligatorio)</span></div>
      <div class="fdesc">El nombre con el que todos conocen el producto. Es lo primero que ve el cliente.
      <span class="example">Ej.: Aviso Caja de Luz para Fachada.</span></div>
    </div>
    <div class="field">
      <div class="fname">2. Referencia comercial <span style="color:var(--text-muted);font-weight:400">(SKU, opcional)</span></div>
      <div class="fdesc">El código interno del producto. <strong>Evita duplicados</strong>: si más adelante vuelves
      a cargar este producto (por Excel), el panel lo reconoce por su referencia y lo actualiza en vez de crearlo de nuevo.
      <span class="example">Ej.: ZM-AVI-001.</span></div>
    </div>
    <div class="field">
      <div class="fname">3. Categoría <span style="color:var(--danger)">*</span> <span style="color:var(--text-muted);font-weight:400">(obligatorio)</span></div>
      <div class="fdesc">Selecciona en la lista la categoría (la que creamos en el Paso 2). Si no existe, pulsa
      el botón <strong>«Nueva»</strong> que está al lado para crearla sin salir de aquí.
      <span class="example">Ej.: Avisos y Publicidad Exterior.</span></div>
    </div>
    <div class="field">
      <div class="fname">4. Unidad de medida</div>
      <div class="fdesc">Cómo se cobra el producto. <strong>Elige bien, porque cambia cómo calcula el bot.</strong> Tiene 5 opciones:</div>
      <table>
        <tr><th>Opción</th><th>Úsala cuando…</th></tr>
        <tr><td><span class="code">Unidad (ud)</span></td><td>Se vende por unidad (la mayoría: bolígrafos, tazas, gorras).</td></tr>
        <tr><td><span class="code">Millar (1.000 uds)</span></td><td>Se vende por paquetes de mil (volantes, tarjetas).</td></tr>
        <tr><td><span class="code">Metro Cuadrado (m²)</span></td><td>Se cobra por área (avisos de fachada, banners grandes).</td></tr>
        <tr><td><span class="code">Metro lineal</span></td><td>Se cobra por longitud (lonas por metro).</td></tr>
        <tr><td><span class="code">Servicio / Adicional</span></td><td>Es un servicio o un extra (instalación, diseño).</td></tr>
      </table>
      <div class="fdesc"><span class="example">Ej.: para el aviso de fachada, elige «Metro Cuadrado (m²)».</span></div>
    </div>
    <div class="img-box">
      <img src="{{IMG:manual-04b-datos-basicos-completo}}" alt="Bloque de datos básicos del formulario con Nombre, Referencia, Categoría y Unidad de medida rellenos">
      <div class="img-caption">Bloque 1 completo: Nombre, Referencia, Categoría y Unidad de medida ya rellenos.</div>
    </div>

    <!-- BLOQUE 2 -->
    <h3>Bloque 2 · Ficha técnica, sinónimos e imagen</h3>
    <div class="field">
      <div class="fname">5. Ficha técnica / Descripción (Materiales, Medidas, etc.)</div>
      <div class="fdesc">Describe materiales, dimensiones y usos. <strong>El bot la lee</strong> cuando el cliente
      pregunta detalles ("¿de qué material es?", "¿qué medidas tiene?").
      <span class="example">Ej.: "Aviso luminoso tipo caja de luz. Estructura en lámina galvanizada o aluminio con lona panaflex translúcida e iluminación LED interior."</span></div>
    </div>
    <div class="field">
      <div class="fname">6. 🏷️ Sinónimos Específicos del Producto</div>
      <div class="fdesc">¡Clave para que el bot entienda al cliente! Escribe las palabras con las que la gente
      nombra <em>este</em> producto en WhatsApp, separadas por comas. El bot ya hereda los sinónimos de la categoría;
      aquí pones los que son <strong>exclusivos de este producto</strong>.
      <span class="example">Ej.: letrero iluminado, aviso de fachada, caja de luz, valla luminosa de local.</span></div>
      <div class="callout why" style="margin-top:10px">
        <span class="ctitle">🤖 ¿Por qué importa tanto esto?</span>
        Si un cliente escribe "quiero un letrero que brille de noche" y tú solo pusiste "Aviso Caja de Luz", el bot
        podría no encontrarlo. Con los sinónimos bien puestos, el bot conecta "letrero que brilla" con tu aviso.
      </div>
    </div>
    <div class="field">
      <div class="fname">7. URL de la Imagen del Producto + «Subir imagen desde tu PC»</div>
      <div class="fdesc">La foto real del producto. El bot la envía al cliente por chat <strong>y además la usa para
      reconocerlo mejor</strong> (ver más abajo). Dos formas de ponerla:</div>
      <ul style="margin:6px 0 0 22px">
        <li><strong>«Subir imagen desde tu PC»</strong> (recomendado): subes una foto desde tu computador.</li>
        <li><strong>Pegar una URL</strong> de imagen en el campo de texto.</li>
      </ul>
    </div>
    <div class="callout warn" style="margin-top:14px">
      <span class="ctitle">⏳ Importante: la foto se sube DESPUÉS de guardar, no antes</span>
      Mientras <strong>creas</strong> un producto, debajo del campo de imagen verás un aviso en gris:
      <em>«Guarda el producto primero para habilitar la subida»</em>. En ese momento el botón aún no funciona.
      Es normal: el sistema necesita que el producto ya exista para poder colgarle la foto.
    </div>
    <div class="img-box">
      <img src="{{IMG:manual-img-modo-crear}}" alt="Sección de imagen en modo crear producto, mostrando el aviso de que hay que guardar primero">
      <div class="img-caption">Mientras CREAS el producto: el botón de subir imagen está en espera, con el aviso «Guarda el producto primero».</div>
    </div>
    <h3>El paso que faltaba: guardar y luego subir la foto</h3>
    <ol class="steps">
      <li>Termina de rellenar todos los campos de la ficha y pulsa <strong>«Guardar Producto»</strong>.</li>
      <li>El producto queda creado. El panel se queda abierto, ahora en modo edición (el aviso gris desaparece y el
      botón «Subir imagen desde tu PC» queda <strong>habilitado</strong>).</li>
      <li>Pulsa <strong>«Subir imagen desde tu PC»</strong> y elige la foto. Verás <em>«Subiendo y procesando…»</em>.
      Espera unos segundos (está preparando la imagen y su conexión inteligente).</li>
      <li>Cuando termine, la foto aparece como vista previa en el formulario. ¡Listo!</li>
    </ol>
    <div class="img-box">
      <img src="{{IMG:manual-img-modo-editar}}" alt="Sección de imagen en modo editar producto, con el botón Subir imagen desde tu PC ya habilitado">
      <div class="img-caption">Ya GUARDADO el producto: el botón «Subir imagen desde tu PC» está habilitado. Ahora sí puedes subir la foto.</div>
    </div>
    <div class="callout why">
      <span class="ctitle">🤖 ¿Qué es la "conexión inteligente" y por qué subirla tarda un momento?</span>
      Cuando subes la foto, el sistema crea una <strong>memoria visual</strong> del producto y la une con el texto de
      la ficha. Gracias a eso, el bot puede reconocer el producto aunque el cliente lo describa con otras palabras, y le
      puede mostrar la foto por WhatsApp. <strong>Eso ocurre solo, automáticamente, al subir la imagen</strong>: no hay
      que pulsar ningún botón extra. Por eso subir la foto tarda unos segundos más de lo normal.
    </div>
    <div class="callout rule">
      <span class="ctitle">⚠️ Regla de oro nº 5 — Sin foto, el bot está "medio ciego"</span>
      Si creas un producto <strong>sin foto</strong>, el bot solo lo encontrará si el cliente nombra palabras muy
      parecidas al nombre exacto. <strong>Con foto, lo reconoce mucho mejor.</strong> A todo producto que quieras
      vender bien, <strong>sube su foto</strong> después de crearlo.
    </div>
    <div class="img-box">
      <img src="{{IMG:manual-04c-ficha-sinonimos-imagen}}" alt="Bloque de ficha técnica y sinónimos del producto ya rellenos">
      <div class="img-caption">Bloque 2: la ficha técnica y los sinónimos del producto (la foto se agrega tras guardar).</div>
    </div>

    <!-- BLOQUE 3 -->
    <h3>Bloque 3 · Condiciones comerciales</h3>
    <div class="field">
      <div class="fname">8. Cantidad mínima de pedido</div>
      <div class="fdesc">El mínimo de unidades que se vende. Por defecto es 1. Si pones, por ejemplo, 50, el bot
      no cotiza cantidades menores. <span class="example">Ej.: 1.</span></div>
    </div>
    <div class="field">
      <div class="fname">9. Interruptor «Producto Activo para WhatsApp»</div>
      <div class="fdesc">Decide si el bot puede ofrecer este producto.</div>
      <div class="legend">
        <span class="badge b-on">ON (azul) → el bot SÍ lo ofrece</span>
        <span class="badge b-off">OFF (gris) → el bot NO lo ve</span>
      </div>
      <div class="callout tip" style="margin-top:8px">
        <span class="ctitle">💡 Úsalo para "pausar" un producto</span>
        Si se te agotó un insumo, apaga este interruptor. No hace falta borrar el producto. Cuando vuelva, lo enciendes.
      </div>
    </div>
    <div class="field">
      <div class="fname">10. Interruptor «El precio incluye IVA (19%)»</div>
      <div class="fdesc">Indica si el precio que cargaste ya trae el IVA incluido. Así el bot informa correctamente el impuesto.</div>
    </div>
    <div class="field">
      <div class="fname">11. Notas internas / Condiciones adicionales</div>
      <div class="fdesc">Reglas comerciales internas que el bot tiene en cuenta al cotizar.
      <span class="example">Ej.: "Precio por metro cuadrado. Uso exterior."</span></div>
    </div>
    <div class="img-box">
      <img src="{{IMG:manual-04d-condiciones-toggles}}" alt="Bloque de condiciones: cantidad mínima, interruptores de activo e IVA, y notas internas">
      <div class="img-caption">Bloque 3: cantidad mínima, interruptores de Activo e IVA, y notas internas.</div>
    </div>

    <!-- BLOQUE 4 -->
    <h3>Bloque 4 · Precios</h3>
    <p>Aquí se define <strong>cuánto cuesta</strong> el producto. El panel lo llama "Rangos de Precios", pero en la práctica
    esta misma tabla sirve para <strong>tres situaciones distintas</strong>. Veamos cada una con su ejemplo, de la más fácil
    a la más completa.</p>
    <div class="callout info">
      <span class="ctitle">ℹ️ Lo primero que hay que saber</span>
      Ya viene creada <strong>una fila</strong> de precio con valores de ejemplo: variante «Estándar», Mín=1, Máx=vacío,
      Base «Unitario». Tú solo <strong>escribes el precio</strong> en esa fila y, según el caso, agregas más filas con
      «Agregar Rango». No es obligatorio tener varias filas: con una sola basta para la mayoría de los productos.
    </div>
    <table>
      <tr><th>Columna</th><th>Qué significa</th></tr>
      <tr><td><strong>Variante</strong></td><td>El nombre de esa versión (material, tamaño, técnica) o simplemente «Estándar».</td></tr>
      <tr><td><strong>Mín</strong></td><td>Cantidad mínima de esa fila. Casi siempre es 1.</td></tr>
      <tr><td><strong>Máx</strong></td><td>Cantidad máxima. <strong>Vacío = sin tope</strong> (el más común).</td></tr>
      <tr><td><strong>Precio</strong></td><td>El valor en pesos, <strong>sin puntos ni comas</strong> (ej.: <span class="code">15000</span>).</td></tr>
      <tr><td><strong>Base</strong></td><td>Cómo se cobra esa fila: <span class="code">Unitario</span> (por unidad/m²) o <span class="code">Lote Total</span> (precio cerrado por el lote).</td></tr>
    </table>

    <h3>Caso A — Un solo precio (el más común)</h3>
    <p>Para un producto que <strong>no tiene variantes</strong> ni descuentos por cantidad (una taza, un bolígrafo, una gorra
    con precio fijo), basta con <strong>una sola fila</strong>: déjala como «Estándar», Mín 1, Máx vacío, Base Unitario,
    y escribe el precio. El bot multiplicará <strong>precio × cantidad</strong> que pida el cliente.</p>
    <div class="img-box">
      <img src="{{IMG:manual-precio-un-solo-precio}}" alt="Producto de un solo precio: una taza con una sola fila Estándar a 15000">
      <div class="img-caption">Caso A — Un solo precio: una taza a $15.000, una sola fila «Estándar». Si el cliente pide 4, el bot cotiza $60.000.</div>
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 Clave: la Unidad de medida controla cómo se cobra</span>
      Para este caso, la <strong>Unidad de medida</strong> del producto debe ser <span class="code">Unidad (ud)</span>.
      Así el bot multiplica precio × cantidad. Si el producto se vende por metro cuadrado, elige
      <span class="code">Metro Cuadrado (m²)</span> y el bot pedirá las medidas al cliente (ver Caso C).
    </div>

    <h3>Caso B — Precio según el material, tamaño o técnica</h3>
    <p>Si el producto tiene <strong>varias versiones con distinto precio</strong> (un aviso con o sin luz, una camiseta en
    distintos materiales, una gorra con 1 o 2 tintas), creas <strong>una fila por cada versión</strong>, todas con Mín=1
    y Máx vacío. En «Variante» describes la diferencia y en «Precio» el valor de esa versión.</p>
    <div class="img-box">
      <img src="{{IMG:manual-04e-rangos-precio}}" alt="Producto con tres variantes: Sin iluminación, Con LED interior y Backlight, cada una con su precio">
      <div class="img-caption">Caso B — Precio por variante: el mismo aviso en 3 versiones (Sin iluminación, Con LED interior, Backlight), cada una con su precio.</div>
    </div>
    <div class="callout why">
      <span class="ctitle">🤖 ¿Cómo responde el bot en este caso?</span>
      Cuando un producto tiene varias filas de variante, el bot prepara una línea por cada opción
      («Si elige <em>Con LED interior</em>: $…; Si elige <em>Sin iluminación</em>: $…») y presenta las opciones para que el
      cliente decida. <strong>No elige una por él</strong>: le muestra las alternativas.
    </div>

    <h3>Caso C — Precio por metro cuadrado (avisos, banners, lonas)</h3>
    <p>Para productos que se cotizan por área, el procedimiento es igual (filas con precio), pero hay <strong>dos detalles</strong>:</p>
    <ol class="steps">
      <li>Pon la <strong>Unidad de medida</strong> del producto en <span class="code">Metro Cuadrado (m²)</span> (no «Unidad»).
      Esto es lo que de verdad le dice al bot que debe calcular por área.</li>
      <li>Carga <strong>una fila por variante</strong> con su precio por m², Base «Unitario».</li>
    </ol>
    <div class="callout warn">
      <span class="ctitle">⚠️ Importante sobre los avisos por m²</span>
      Cuando la unidad es m², <strong>el bot le pide al cliente las medidas exactas</strong> (ancho y alto en cm) y calcula
      el área para cotizar. Por eso un aviso que vale $420.000 el m² y mide 3×1 m se cotiza en $1.260.000.
      <br><br>
      Si el aviso tiene varias variantes por material, lo más claro para el cliente es
      <strong>crear un producto por cada variante</strong> (ej.: "Aviso Caja de Luz Con LED", "Aviso Plano Sin Iluminación"),
      cada uno con su precio por m². Así el bot cotiza sin ambigüedad.
    </div>

    <h3>Caso D — Descuento por cantidad (precio por volumen)</h3>
    <p>Si el producto <strong>baja de precio cuando llevan más</strong> (1 a 49 cuestan $8.500 c/u; de 50 a 199, $7.500 c/u;
    de 200 en adelante, $6.500 c/u), creas una fila por cada escalón con sus Mín y Máx. El bot elige el precio según
    cuántas unidades pida el cliente.</p>
    <table>
      <tr><th>Variante</th><th>Mín</th><th>Máx</th><th>Precio</th><th>Base</th></tr>
      <tr><td>Estándar</td><td>1</td><td>49</td><td>8500</td><td>Unitario</td></tr>
      <tr><td>Estándar</td><td>50</td><td>199</td><td>7500</td><td>Unitario</td></tr>
      <tr><td>Estándar</td><td>200</td><td>(vacío)</td><td>6500</td><td>Unitario</td></tr>
    </table>
    <div class="callout rule">
      <span class="ctitle">⚠️ Regla de oro nº 2</span>
      Si dejas el <strong>Precio vacío o en 0</strong>, ese producto <strong>no se ofrecerá con precio</strong>: el bot lo
      dejará fuera de las propuestas porque no tiene con qué cotizarlo. <strong>No se inventa un valor.</strong>
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 ¿«Unitario» o «Lote Total»?</span>
      <strong>Unitario</strong> = el precio es por cada unidad (o por cada m²). Es el más usado.
      <strong>Lote Total</strong> = el precio es cerrado por todo el lote (ej.: "tiras de 1.000 unidades a $130.000 el lote").
    </div>

    <h3>Guardar el producto</h3>
    <p>Al final del panel está el botón <strong>«Guardar Producto»</strong>. El panel <strong>se queda abierto</strong>
    tras guardar: así puedes subir la foto enseguida. Para crear otro producto parecido, usa <strong>«Duplicar ficha»</strong>.</p>
    <div class="img-box">
      <img src="{{IMG:manual-04f-pie-drawer-guardar}}" alt="Pie del panel lateral con los botones Cancelar y Guardar Producto">
      <div class="img-caption">El pie del panel: «Cancelar» y «Guardar Producto».</div>
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 Resumen del orden completo</span>
      <strong>1.</strong> Llenar la ficha → <strong>2.</strong> Pulsar «Guardar Producto» → <strong>3.</strong> Pulsar «Subir imagen desde tu PC».
      ¡Y listo! El producto queda creado, con precio y con su foto conectada.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p2')">← Anterior</button><button class="nav-btn next" onclick="goTo('p4')">Siguiente: Editar →</button></div>
  </section></div>

  <!-- ===================== PASO 4 ===================== -->
  <div class="screen" id="screen-p4"><section class="step-card">
    <div class="step-header"><span class="step-num">4</span> Editar, pausar, duplicar o eliminar</div>
    <p class="step-intro">Cómo mantener el catálogo al día cuando cambian precios o disponibilidad.</p>
    <h3>4.1  Editar un producto</h3>
    <ol class="steps">
      <li>Búscalo con la barra superior (por nombre o referencia).</li>
      <li>En su fila, pulsa el botón del <strong>lápiz</strong> («Editar ficha y precios»).</li>
      <li>Se abre el mismo panel lateral, ahora titulado «Editar Producto y Precios».</li>
      <li>Cambia lo que necesites y pulsa <strong>«Guardar Producto»</strong>.</li>
    </ol>
    <div class="img-box">
      <img src="{{IMG:manual-07-editar-producto}}" alt="Panel lateral de edición de un producto existente titulado Editar Producto y Precios">
      <div class="img-caption">El panel en modo edición: «Editar Producto y Precios». Aquí aparece también «Duplicar ficha».</div>
    </div>
    <h3>4.2  Pausar (sin borrar)</h3>
    <p>Si un producto se agotó, basta con abrirlo y <strong>apagar el interruptor «Producto Activo para WhatsApp»</strong>.
    El producto sigue en el catálogo, pero el bot deja de ofrecerlo. Cuando vuelva, lo enciendes y listo.</p>
    <div class="callout info">
      <span class="ctitle">ℹ️ Edición rápida de precio</span>
      En la tabla, el precio se puede <strong>editar directamente</strong> haciendo clic sobre él ("Clic para editar el
      precio de entrada"), sin abrir el producto. Ideal para cambiar precios rápido.
    </div>
    <h3>4.3  Acciones masivas (para muchos productos a la vez)</h3>
    <p>Si necesitas cambiar varios productos, márcalos con las casillas de la izquierda. Aparece una barra con acciones:</p>
    <ul class="steps">
      <li><strong>Activar / Desactivar</strong>: encender o apagar varios a la vez.</li>
      <li><strong>Ajustar precios</strong>: subir o bajar precios (ej.: <span class="code">-10</span> baja, <span class="code">5</span> sube).</li>
      <li><strong>Mover a categoría</strong>: pasar varios productos a otra categoría.</li>
      <li><strong>Eliminar</strong>: borrar varios (pide confirmación y <strong>no se puede deshacer</strong>).</li>
    </ul>
    <div class="img-box">
      <img src="{{IMG:manual-08-acciones-masivas}}" alt="Barra de acciones masivas que aparece al seleccionar varios productos">
      <div class="img-caption">Al marcar varios productos aparece esta barra con las acciones masivas.</div>
    </div>
    <div class="callout warn">
      <span class="ctitle">❌ Eliminar es definitivo</span>
      Borrar un producto <strong>borra también todos sus rangos de precio</strong> y no se puede deshacer.
      Si solo quieres dejar de venderlo un tiempo, usa «Desactivar» en lugar de eliminar.
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 Duplicar ficha</span>
      Para crear productos muy parecidos (mismo material, distintos tamaños), edita uno existente y pulsa
      <strong>«Duplicar ficha»</strong>: crea una copia en borrador. Le cambias nombre y precio y la guardas.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p3')">← Anterior</button><button class="nav-btn next" onclick="goTo('p5')">Siguiente: Excel →</button></div>
  </section></div>

  <!-- ===================== PASO 5 ===================== -->
  <div class="screen" id="screen-p5"><section class="step-card">
    <div class="step-header"><span class="step-num">5</span> Carga masiva por Excel</div>
    <p class="step-intro">Para cargar o actualizar muchos productos de una sola vez.</p>
    <p>Debajo de la tabla de productos está el módulo <strong>«Importar / Exportar catálogo»</strong>, con tres botones:</p>
    <ul class="steps">
      <li><strong>Plantilla</strong>: descarga un Excel vacío con las columnas correctas. <span class="example">Empieza por aquí siempre.</span></li>
      <li><strong>Exportar Excel</strong>: descarga todo tu catálogo actual (para revisarlo o editarlo).</li>
      <li><strong>Importar Excel/CSV</strong>: sube tu Excel ya relleno para crear o actualizar productos.</li>
    </ul>
    <div class="img-box">
      <img src="{{IMG:manual-09-import-export}}" alt="Módulo de importar y exportar catálogo con los botones Plantilla, Exportar Excel e Importar">
      <div class="img-caption">El módulo de Importar / Exportar catálogo, debajo de la tabla.</div>
    </div>
    <h3>Columnas del Excel</h3>
    <p>La plantilla trae estas columnas (los nombres importan: no los cambies):</p>
    <table>
      <tr><th>Columna</th><th>¿Obligatoria?</th><th>Qué va</th></tr>
      <tr><td><span class="code">categoria</span></td><td>Sí</td><td>La categoría. Si no existe, se crea sola.</td></tr>
      <tr><td><span class="code">nombre</span></td><td>Sí</td><td>Nombre del producto.</td></tr>
      <tr><td><span class="code">referencia</span></td><td>No</td><td>SKU. <strong>Clave</strong>: evita duplicar al re-importar.</td></tr>
      <tr><td><span class="code">descripcion</span></td><td>No</td><td>Ficha técnica (materiales, medidas).</td></tr>
      <tr><td><span class="code">unidad</span></td><td>No</td><td>unidad / m2 / millar / metro / servicio.</td></tr>
      <tr><td><span class="code">cantidad_minima</span></td><td>No</td><td>Cantidad mínima de pedido.</td></tr>
      <tr><td><span class="code">precio</span></td><td>No</td><td>Precio. <strong>Vacío = sin precio</strong>.</td></tr>
      <tr><td><span class="code">variante</span></td><td>No</td><td>Nombre de la variante (una fila por variante).</td></tr>
      <tr><td><span class="code">cantidad_min</span> / <span class="code">cantidad_max</span></td><td>No</td><td>Rango de cantidades del precio.</td></tr>
      <tr><td><span class="code">base_precio</span></td><td>No</td><td>unitario / lote_total.</td></tr>
      <tr><td><span class="code">activo</span> / <span class="code">precio_incluye_iva</span></td><td>No</td><td>SI o NO.</td></tr>
    </table>
    <h3>Pasos para importar</h3>
    <ol class="steps">
      <li>Pulsa <strong>«Plantilla»</strong> y descarga el Excel base.</li>
      <li>Rellénalo. <strong>Una fila por cada variante</strong> del producto (no mezcles variantes en una sola fila).</li>
      <li>Pulsa <strong>«Importar Excel/CSV»</strong> y sube tu archivo.</li>
      <li>Revisa la <strong>vista previa</strong> antes de confirmar. Si algo está mal, corrígelo en el Excel y vuelve a subirlo.</li>
      <li>Confirma. El panel te dirá cuántos productos creó y cuántos actualizó.</li>
    </ol>
    <div class="callout rule">
      <span class="ctitle">⚠️ Regla de oro nº 3 — El precio vacío</span>
      Si dejas la celda <strong>precio</strong> vacía, el producto se crea <strong>sin precio</strong>. El bot
      <strong>no lo ofrecerá como propuesta</strong> y <strong>nunca inventará un valor</strong>. Deja el precio vacío
      solo si de verdad quieres que el bot no lo cotice todavía. Si quieres que se venda, <strong>llena el precio siempre</strong>.
    </div>
    <div class="callout warn">
      <span class="ctitle">❌ Los sinónimos NO van en el Excel</span>
      El Excel <strong>no tiene columna de sinónimos</strong>. Tras importar, los sinónimos específicos de cada producto
      <strong>se pierden</strong>. Después de importar, entra producto por producto y revisa los
      <strong>Sinónimos Específicos del Producto</strong> (los de categoría sí se mantienen). Es la parte que siempre se hace a mano.
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 Truco Pro</span>
      Antes de importar, <strong>exporta</strong> tu catálogo actual. Así tienes un respaldo. Y recuerda: la columna
      <span class="code">referencia</span> es la que hace que un producto se <em>actualice</em> en vez de duplicarse al re-importar.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p4')">← Anterior</button><button class="nav-btn next" onclick="goTo('p6')">Siguiente: Reglas del negocio →</button></div>
  </section></div>

  <!-- ===================== PASO 6 ===================== -->
  <div class="screen" id="screen-p6"><section class="step-card">
    <div class="step-header"><span class="step-num">6</span> Reglas del negocio: pago, entrega y garantía</div>
    <p class="step-intro">Estas reglas NO van en el catálogo. Van en otra sección: Personalización.</p>
    <p>Las condiciones comerciales (cómo se paga, cuánto tarda la entrega, qué garantía tienen los productos, los
    datos que se piden al cerrar una venta) <strong>no se configuran aquí</strong>, porque aplican a todo el negocio
    y no a un producto individual. Se configuran en:</p>
    <p style="text-align:center; margin:18px 0;"><span class="code">Personalización → Temas</span> &nbsp;·&nbsp; <span class="code">zoompublicidad.tech/personalizacion</span></p>
    <p>Desde ahí se definen, entre otras:</p>
    <ul class="steps">
      <li><strong>Medios y condiciones de pago</strong> (ej.: anticipo para iniciar producción).</li>
      <li><strong>Tiempos de entrega</strong> y de producción.</li>
      <li><strong>Garantía</strong> de los productos.</li>
      <li><strong>Datos que se piden al cerrar</strong> (nombre, NIT/cédula, correo, dirección de envío).</li>
      <li><strong>Políticas</strong> específicas (ej.: normativa de avisos, qué incluye una cotización).</li>
    </ul>
    <div class="callout rule">
      <span class="ctitle">⚠️ Regla de oro nº 4</span>
      Si una de estas reglas <strong>no se llena</strong> en Personalización, el bot <strong>no la inventa</strong>:
      omite la frase y, si el cliente insiste, responde que lo consulta con el equipo. Por eso es importante tener
      siempre completos los datos de pago, entrega y garantía.
    </div>
    <div class="callout info">
      <span class="ctitle">ℹ️ ¿Dónde van las normativas?</span>
      Cosas como la Ley 140 de 1994 (publicidad exterior) o qué incluye una cotización de aviso van como
      <strong>temas</strong> en Personalización, no como productos. El catálogo es solo para productos y precios.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p5')">← Anterior</button><button class="nav-btn next" onclick="goTo('anexo')">Siguiente: Anexo →</button></div>
  </section></div>

  <!-- ===================== ANEXO ===================== -->
  <div class="screen" id="screen-anexo"><section class="step-card">
    <div class="step-header"><span class="step-num">★</span> Anexo: las otras dos pestañas</div>
    <p class="step-intro">La Base de Conocimiento tiene 3 pestañas. Hasta ahora vimos «Catálogo de Productos». Estas son las otras dos.</p>
    <h3>Glosario Comercial y Sinónimos</h3>
    <p>Aquí se definen <strong>términos de jerga del cliente</strong> y cómo debe actuar el bot con ellos. Sirve para
    enseñarle modismos o aclarar significados. Cada regla tiene un «Término / Jerga del cliente» y su
    «Significado / Cómo debe actuar la IA».</p>
    <div class="img-box">
      <img src="{{IMG:manual-10-glosario}}" alt="Pestaña Glosario Comercial y Sinónimos">
      <div class="img-caption">Pestaña «Glosario Comercial y Sinónimos»: términos de jerga del cliente.</div>
    </div>
    <h3>Precios de Marcación</h3>
    <p>Aquí viven los <strong>servicios de marcación/impresión</strong> (DTF, serigrafía, cuadernos, etc.) con sus
    tarifas por cantidad o por cm². Funciona igual que un producto: cada servicio tiene sus rangos de precio. Si un
    servicio no tiene tarifas cargadas, el bot no lo puede cotizar.</p>
    <div class="img-box">
      <img src="{{IMG:manual-11-precios-marcacion}}" alt="Pestaña Precios de Marcación con los servicios y sus tarifas">
      <div class="img-caption">Pestaña «Precios de Marcación»: tarifas de los servicios de impresión/marcación.</div>
    </div>
    <div class="callout tip">
      <span class="ctitle">💡 Resumen de las 3 pestañas</span>
      <strong>Catálogo de Productos</strong> = tus productos para vender.<br>
      <strong>Glosario Comercial</strong> = cómo hablarle al cliente y entender su jerga.<br>
      <strong>Precios de Marcación</strong> = tarifas de servicios de impresión/marcación.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('p6')">← Anterior</button><button class="nav-btn next" onclick="goTo('faq')">Siguiente: Preguntas frecuentes →</button></div>
  </section></div>

  <!-- ===================== FAQ ===================== -->
  <div class="screen" id="screen-faq"><section class="step-card">
    <div class="step-header"><span class="step-num">❓</span> Preguntas frecuentes y problemas comunes</div>
    <p class="step-intro">Lo que más suele pasar, y cómo resolverlo.</p>
    <h3>Sobre la imagen y la "conexión inteligente"</h3>
    <p><strong>1. Subí la foto pero el bot no la envía por WhatsApp.</strong></p>
    <p>Suele ser porque la subida no terminó bien. Vuelve a abrir el producto (editar) y comprueba que la imagen se ve
    en la vista previa. Si no, súbela de nuevo y espera a que aparezca la vista previa (mientras procesa verás «Subiendo y procesando…»).</p>
    <p><strong>2. ¿Por qué la subida de la foto tarda unos segundos?</strong></p>
    <p>Porque al subir la imagen el sistema prepara la "conexión inteligente" del producto (su memoria visual). Es automático
    y ocurre una sola vez por foto. No hay que pulsar nada extra.</p>
    <p><strong>3. Creé un producto pero no le pude poner foto.</strong></p>
    <p>Es normal al crear: la foto se sube <strong>después</strong> de guardar (ver Paso 3). Guarda el producto primero,
    y entonces sí aparecerá habilitado el botón «Subir imagen desde tu PC».</p>
    <p><strong>4. El bot no encuentra un producto que acabo de crear.</strong></p>
    <p>Dos causas habituales: (a) el producto quedó <strong>sin foto</strong>, y sin ella el bot lo encuentra solo si el
    cliente nombra palabras casi idénticas al nombre — súbela; (b) el interruptor <strong>«Producto Activo»</strong> quedó apagado — enciéndelo.</p>
    <h3>Sobre los precios</h3>
    <p><strong>5. Cambié el precio pero el bot sigue dando el anterior.</strong></p>
    <p>Asegúrate de haber <strong>guardado</strong> el cambio. El cambio se refleja en el siguiente mensaje del cliente;
    si la conversación ya iba, a veces conviene que el cliente vuelva a preguntar.</p>
    <p><strong>6. ¿Cómo pongo el precio de algo que siempre cuesta lo mismo?</strong></p>
    <p>Un solo rango «Estándar», Mín 1, Máx vacío, precio X, Base «Unitario», y la Unidad de medida en «Unidad (ud)».
    El bot multiplicará precio × cantidad. (Ver Caso A del Paso 3.)</p>
    <p><strong>7. Mi producto se vende por metro cuadrado. ¿Cómo lo cargo?</strong></p>
    <p>Pon la Unidad de medida en «Metro Cuadrado (m²)» y carga el precio por m² en una fila «Estándar», Base «Unitario».
    El bot le pedirá al cliente las medidas y calculará el área. Si el aviso tiene variantes por material, lo más claro es
    crear un producto por cada variante (ver Caso C del Paso 3).</p>
    <p><strong>8. ¿Qué pasa si dejo el precio en blanco o en 0?</strong></p>
    <p>El producto queda <strong>sin precio</strong>, así que el bot <strong>no lo ofrece</strong> (no inventa un valor).
    Carga siempre el precio real. Si de verdad no quieres cotizarlo todavía, mejor déjalo con el interruptor «Activo» apagado.</p>
    <p><strong>9. El cliente pidió menos del mínimo. ¿Qué hace el bot?</strong></p>
    <p>Si configuraste una «Cantidad mínima de pedido» y el cliente pide menos, el bot igual le da un <strong>precio
    referencial</strong> y añade la nota «sujeto a aprobación y disponibilidad». Nunca lo deja sin respuesta.</p>
    <h3>Sobre el Excel</h3>
    <p><strong>10. Cargué productos por Excel y ahora el bot no encuentra algunos que sí encontraba.</strong></p>
    <p>El Excel <strong>no carga sinónimos</strong>. Tras una importación, los sinónimos específicos de cada producto se
    pierden. Entra a los productos afectados y vuelve a llenar el campo «Sinónimos Específicos del Producto».</p>
    <p><strong>11. Al importar se me duplicaron productos.</strong></p>
    <p>Pasa cuando dos productos comparten nombre pero <strong>no tienen referencia (SKU)</strong>. La referencia es la
    que evita duplicados: al re-importar, el sistema reconoce el producto y lo actualiza en vez de crearlo.</p>
    <p><strong>12. El Excel me da error al importar.</strong></p>
    <p>Revisa que las columnas se llamen igual que en la plantilla (no cambies los nombres de la fila 1) y que cada fila
    tenga <strong>nombre</strong> y <strong>categoría</strong>, que son obligatorios. El panel te muestra una vista previa
    antes de confirmar.</p>
    <h3>Sobre el catálogo en general</h3>
    <p><strong>13. ¿Cómo dejo de vender un producto sin borrarlo?</strong></p>
    <p>Ábrelo y apaga el interruptor «Producto Activo para WhatsApp». El producto sigue en el catálogo, pero el bot deja
    de ofrecerlo. Cuando vuelvas a tenerlo, lo enciendes.</p>
    <p><strong>14. El bot menciona medios de pago o tiempos de entrega incorrectos.</strong></p>
    <p>Esos datos no van en el catálogo: se configuran en <strong>Personalización → Temas</strong> (Paso 6). Si están mal
    o incompletos, corrígelos ahí. Si un dato falta, el bot no lo inventa: dice que lo consulta con el equipo.</p>
    <p><strong>15. ¿Cómo pruebo un producto sin molestar a clientes reales?</strong></p>
    <p>Ve a <span class="code">Personalización → Simulador</span> y escribe como si fueras un cliente (ej.: «¿cuánto vale un
    aviso de caja de luz de 3×1 metros?»). El simulador usa el mismo bot que WhatsApp, sin enviar nada a nadie.</p>
    <div class="callout info">
      <span class="ctitle">¿No encuentras tu problema aquí?</span>
      Anota qué producto o conversación falla y avisa al administrador del panel. Mientras más concreto seas
      (qué producto, qué preguntó el cliente, qué respondió el bot), más fácil será resolverlo.
    </div>
    <div class="nav-buttons"><button class="nav-btn" onclick="goTo('anexo')">← Anterior</button><button class="nav-btn next" onclick="goTo('resumen')">🏁 Ver resumen →</button></div>
  </section></div>

  <!-- ===================== RESUMEN FINAL ===================== -->
  <div class="screen" id="screen-resumen"><section class="step-card" style="text-align:center;">
    <div class="step-header" style="justify-content:center;"><span class="step-num">✓</span> ¡Listo! Resumen en 5 reglas</div>
    <p class="step-intro">Si recuerdas esto, ya sabes manejar el catálogo.</p>
    <ol class="steps" style="text-align:left; max-width:640px; margin:20px auto;">
      <li><strong>El bot no inventa precios.</strong> Sin precio cargado, el producto no se ofrece.</li>
      <li><strong>Todo producto necesita categoría.</strong> Créala primero si no existe.</li>
      <li><strong>Los sinónimos son la clave del acierto.</strong> Piensa como el cliente y pon todas sus palabras.</li>
      <li><strong>El interruptor "Activo" pausa sin borrar.</strong> Úsalo en vez de eliminar.</li>
      <li><strong>Los datos del negocio van en Personalización,</strong> no en el catálogo.</li>
    </ol>
    <div class="callout tip" style="text-align:left; max-width:640px; margin:24px auto;">
      <span class="ctitle">🎁 Un último consejo</span>
      Después de crear o editar un producto, <strong>pruébalo en el Simulador</strong>
      (<span class="code">Personalización → Simulador</span>) antes de darlo por bueno. Es la forma más rápida de
      confirmar que el bot lo encuentra y lo cotiza bien, sin molestar a clientes.
    </div>
    <div class="nav-buttons" style="max-width:640px; margin:28px auto 0;">
      <button class="nav-btn" onclick="goTo('faq')">← Anterior</button>
      <button class="nav-btn next" onclick="goHome()">🏠 Volver al inicio</button>
    </div>
  </section></div>

  <footer>Manual de la Base de Conocimiento · KnowledgeBot · Zoom Publicidad</footer>
</div>

<script>
  const ORDER = ['home','hojas','p0','p1','p2','p3','p4','p5','p6','anexo','faq','resumen'];
  const TITLES = {
    home:'Inicio', hojas:'Hojas de categoría', p0:'Antes de empezar', p1:'Ingresar al panel', p2:'Categorías y sinónimos',
    p3:'Crear un producto', p4:'Editar, pausar y eliminar', p5:'Carga masiva por Excel',
    p6:'Reglas del negocio', anexo:'Glosario y Precios', faq:'Preguntas frecuentes', resumen:'Resumen'
  };
  function show(id){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + id);
    if(el){ el.classList.add('active'); }
    const idx = ORDER.indexOf(id);
    const pct = Math.round((idx / (ORDER.length-1)) * 100);
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPct').textContent = id==='home' ? '0%' : pct + '%';
    document.getElementById('crumb').innerHTML = id==='home' ? 'Inicio' : 'Manual · <b>' + (TITLES[id]||'') + '</b>';
    window.scrollTo(0,0);
    history.replaceState(null,'', id==='home' ? location.pathname : '#'+id);
  }
  function goTo(id){ show(id); }
  function goHome(){ show('home'); }
  (function init(){
    const h = location.hash.replace('#','');
    show(h && ORDER.includes(h) ? h : 'home');
  })();
  document.addEventListener('keydown', (e) => {
    const cur = (location.hash.replace('#','')) || 'home';
    const id = ORDER.includes(cur) ? cur : 'home';
    const idx = ORDER.indexOf(id);
    if(e.key === 'ArrowRight' && idx < ORDER.length-1){ goTo(ORDER[idx+1]); }
    if(e.key === 'ArrowLeft' && idx > 0){ idx===1 ? goHome() : goTo(ORDER[idx-1]); }
  });
</script>
</body>
</html>
