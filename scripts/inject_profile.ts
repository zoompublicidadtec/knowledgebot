import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from '@xenova/transformers';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const rawText = `Zoom Publicidad es una empresa ubicada en Bogotá que fabrica y personaliza artículos promocionales y soluciones de publicidad impresa para empresas, con foco en regalos corporativos, papelería empresarial, señalización y piezas en acrílico, manejando todo bajo esquema de diseño y personalización a la medida del cliente. En su discurso se presentan como especialistas en artículos promocionales personalizados, cuadernos corporativos y soluciones de papelería empresarial, con varios años de experiencia (en algunas secciones hablan de más de 9 años y en otras de 12 años en el mercado), y con el respaldo de cientos de empresas que ya han trabajado con ellos.

En la parte de regalos corporativos y artículos promocionales, Zoom Publicidad declara que fabrica y personaliza productos como agendas, cuadernos personalizados, mugs, termos, camisetas y bolígrafos, todos con el logo o la identidad visual de la empresa cliente. Esta línea está claramente orientada a regalos de empresa y merchandising corporativo. También mencionan que trabajan artículos corporativos y diferentes tipos de papelería personalizada.

Dentro de la categoría de productos promocionales personalizados, la empresa hace énfasis en la personalización completa: no se trata solo de vender un mug genérico o un cuaderno genérico, sino de adaptar cada artículo al logo, a los colores institucionales y al mensaje específico. El servicio incluye la fabricación o aprovisionamiento del producto base, la marcación o impresión y en algunos casos el empaquetado.

Otra línea importante es la de papelería comercial y empresarial. Ofrecen servicios de impresión y personalización de productos de papelería para compañías con impresión de alta calidad a precios competitivos. Destacan que han ofrecido estos servicios durante 9 años. Abarcan los productos típicos de papelería de marca.

En el apartado de stickers, etiquetas y vinilos, Zoom Publicidad indica que ofrece stickers personalizados, etiquetas adhesivas y vinilos publicitarios en Bogotá, resaltando dos atributos clave: alta calidad de impresión y excelente adherencia. Se pueden usar para etiquetar productos, empaques, vitrinas y vehículos. Diseñan y producen tirajes personalizados donde cambian el tamaño, el diseño gráfico, el tipo de adhesivo y el sustrato.

Impresión DTF UV: ideal para señalización empresarial, placas corporativas, material POP y personalización de productos, imprimen directamente sobre materiales como acrílico, metal, madera u otros sustratos aptos para tinta UV. Fabrican letreros, placas informativas, señalética y piezas de material POP.

Acrílicos personalizados: avisos en acrílico para oficinas, la señalización corporativa en acrílico, las placas conmemorativas, las letras en acrílico y las piezas decorativas empresariales. No solo venden el material acrílico sin más, sino que diseñan y fabrican las piezas terminadas con cortes, acabados, impresión o grabado.

En el conjunto de productos, la empresa insiste en que la personalización es total. Por ejemplo, al hablar de agendas y cuadernos personalizados, se crean cuadernos corporativos que reflejan la identidad de la marca.

El modelo de precios: no hay un catálogo público con precios unitarios. El precio se maneja siempre vía cotización según el tipo de artículo, la cantidad, los acabados, el material y los tiempos de entrega. Todo es a la medida de cada proyecto.

Ofrecen productos promocionales personalizados para empresas (agendas, cuadernos, mugs, termos, camisetas, bolígrafos y otros artículos corporativos de marca), ofrecen papelería comercial y empresarial personalizada, stickers, etiquetas adhesivas y vinilos publicitarios, prestan servicios de impresión DTF UV, y trabajan acrílicos personalizados en forma de avisos, señalización, placas conmemorativas, letras corpóreas y piezas decorativas empresariales, todo bajo un esquema de diseño e impresión a la medida con asesoría y cotización personalizada.`;

async function run() {
  console.log('Iniciando inyeccion de perfil empresarial...');
  
  const { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  const orgId = orgData![0].id;

  // Split text into paragraphs for chunks
  const paragraphs = rawText.split('\n\n').filter(p => p.trim().length > 10);
  console.log(`Párrafos a inyectar: ${paragraphs.length}`);

  const { data: doc } = await supabase.from('knowledge_documents').insert({
    organization_id: orgId,
    title: 'Información y Perfil Zoom Publicidad.txt',
    source_type: 'manual',
    source_url: 'Investigación del cliente',
  }).select('id').single();

  const documentId = doc!.id;

  console.log('Cargando motor de IA...');
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i];
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data);
    
    await supabase.from('knowledge_chunks').insert({
      organization_id: orgId,
      document_id: documentId,
      content: text,
      embedding: embedding,
      token_count: Math.ceil(text.length / 4)
    });
  }

  console.log('¡INYECCIÓN DEL PERFIL COMPLETA!');
}

run().catch(console.error);
