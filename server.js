const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const app = express();
//const PORT = 3000;
const PORT = process.env.PORT || 3000;

// Habilitar CORS
app.use(cors());

//app.use(express.static('public')); // donde 'public' es la carpeta con tus archivos HTML/CSS/JS

// Ruta principal para verificar que el servidor funciona
app.get('/', (req, res) => {
  res.send('Servidor de búsqueda de anime funcionando correctamente');
});

app.get('/buscar-anime', async (req, res) => {
    const { nombre, timezone = 'America/Mexico_City' } = req.query;
    if (!nombre) return res.status(400).json({ error: 'Falta el parámetro "nombre"' });
    
    console.log(`Buscando anime: ${nombre}`);
    
    try {
        // Configuración avanzada de Axios con timeout y headers más completos
        const nyaaUrl = `https://nyaa.si/?f=0&c=1_2&q=${encodeURIComponent(nombre)}`;
        const response = await axios.get(nyaaUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            },
            timeout: 10000
        });
        
        console.log('Respuesta recibida de Nyaa.si');
        
        const $ = cheerio.load(response.data);
        const resultados = [];
        
        // Verificar si hay contenido HTML
        if (response.data.length < 100) {
            console.log('Respuesta HTML demasiado corta, posible bloqueo');
            console.log(response.data);
            return res.status(500).json({ error: 'Posible bloqueo de Nyaa.si', data: response.data });
        }
        
        // Selector actualizado - la tabla tiene la clase 'torrent-list'
        $('table.torrent-list tbody tr').each((index, row) => {
            // Ignorar filas de encabezado
            if ($(row).hasClass('header')) return;
            
            // Extraer el nombre (segunda columna)
            const nombre = $(row).find('td:nth-child(2) a:not(.comments)').first().text().trim();
            
            // Extraer el enlace magnet
            const enlaceMagnet = $(row).find('td:nth-child(3) a[href^="magnet:"]').attr('href');
            
            // Extraer y procesar la fecha (quinta columna)
            const fechaRaw = $(row).find('td:nth-child(5)').text().trim();
            const fechaElement = $(row).find('td:nth-child(5)');
            
            // Verificar si existe un atributo de datos con la timestamp
            let fechaTimestamp = fechaElement.attr('data-timestamp');
            let fechaFormateada = fechaRaw;
            
            if (fechaTimestamp) {
                // Si existe un timestamp, lo convertimos a la zona horaria especificada
                fechaFormateada = moment.unix(fechaTimestamp).tz(timezone).format('YYYY-MM-DD HH:mm:ss');
            } else {
                // Plan B: Intentar parsear la fecha del texto
                try {
                    fechaFormateada = moment.utc(fechaRaw, 'YYYY-MM-DD HH:mm').tz(timezone).format('YYYY-MM-DD HH:mm:ss');
                } catch (e) {
                    console.log(`Error al parsear fecha: ${fechaRaw}`);
                }
            }
            
            // Extraer tamaño (cuarta columna)
            const tamano = $(row).find('td:nth-child(4)').text().trim();
            
            // Extraer número de seeders y leechers
            const seeders = $(row).find('td:nth-child(6)').text().trim();
            const leechers = $(row).find('td:nth-child(7)').text().trim();
            const downloads = $(row).find('td:nth-child(8)').text().trim();
            
            // Extraer información adicional sobre subtítulos y calidad
            const subtitulos = extraerSubtitulos(nombre);
            const calidad = extraerCalidad(nombre);
            
            // Logs para depurar
            console.log(`--- Fila ${index + 1} ---`);
            console.log('Nombre:', nombre);
            console.log('Fecha original:', fechaRaw);
            console.log('Fecha formateada:', fechaFormateada);
            console.log('Subtítulos:', subtitulos);
            console.log('Calidad:', calidad);
            console.log('---------------------');
            
            // Validar que los campos principales existan
            if (nombre && enlaceMagnet) {
                resultados.push({ 
                    nombre, 
                    enlaceMagnet, 
                    fecha: {
                        original: fechaRaw,
                        formateada: fechaFormateada
                    },
                    tamano,
                    seeders: parseInt(seeders) || 0,
                    leechers: parseInt(leechers) || 0,
                    downloads: parseInt(downloads) || 0,
                    subtitulos,
                    calidad
                });
            }
        });
        
        console.log(`Total de resultados encontrados: ${resultados.length}`);
        
        if (resultados.length === 0) {
            console.log('Estructura HTML de la página:');
            console.log($('body').html().substring(0, 500) + '...');
        }
        
        res.json(resultados);
    } catch (error) {
        console.error('Error detallado:', error.message);
        if (error.response) {
            console.error('Código de estado:', error.response.status);
            console.error('Cabeceras:', error.response.headers);
        }
        res.status(500).json({ 
            error: 'Ocurrió un error al buscar en Nyaa.si', 
            mensaje: error.message,
            codigo: error.response ? error.response.status : 'Sin respuesta'
        });
    }
});

// Función para extraer información de subtítulos del nombre
function extraerSubtitulos(nombre) {
    const resultado = {
        texto: '',
        tipo: ''
    };
    
    // Patrones comunes para identificar subtítulos
    const patronesSubtitulos = [
        /\b(MultiSub|Multi-Sub)\b/i,
        /\b(Spanish|Español|ESP|Castellano|Latino|LatAm)\b/i,
        /\b(English|Inglés|ENG)\b/i,
        /\b(Japanese|Japonés|JAP)\b/i,
        /\bCR_([a-zA-Z_]+)\b/i,
        /\((CR|Crunchyroll|Netflix|Funimation)_([a-zA-Z_]+)\)/i,
        /\b(Latin_America|Latin America|Spain)\b/i
    ];
    
    // Buscar patrones en el nombre
    for (const patron of patronesSubtitulos) {
        const match = nombre.match(patron);
        if (match) {
            if (resultado.texto.length > 0) {
                resultado.texto += ', ';
            }
            resultado.texto += match[0];
        }
    }
    
    // Identificar el tipo de subtítulos
    if (/\b(ASS|SSA)\b/i.test(nombre)) {
        resultado.tipo = 'ASS/SSA';
    } else if (/\b(SRT)\b/i.test(nombre)) {
        resultado.tipo = 'SRT';
    } else if (/\b(VTT)\b/i.test(nombre)) {
        resultado.tipo = 'VTT';
    }
    
    return resultado;
}

// Función para extraer información de calidad del nombre
function extraerCalidad(nombre) {
    const resultado = {
        resolucion: '',
        fuente: '',
        codec: '',
        audio: ''
    };
    
    // Patrones para resolución
    const patronesResolucion = [
        /\b(4K|2160p)\b/i,
        /\b(1080p)\b/i,
        /\b(720p)\b/i,
        /\b(480p)\b/i
    ];
    
    // Patrones para fuente
    const patronesFuente = [
        /\b(BluRay|Blu-Ray|BDRip)\b/i,
        /\b(WEBRip|WEB-DL|WEB)\b/i,
        /\b(DVDRip|DVD-Rip|DVD)\b/i,
        /\b(HDTV|HD-TV)\b/i,
        /\b(CR|Crunchyroll|Netflix|Funimation|Amazon)\b/i
    ];
    
    // Patrones para codec de video
    const patronesCodec = [
        /\b(HEVC|H265|H\.265|x265)\b/i,
        /\b(H264|H\.264|x264|AVC)\b/i,
        /\b(VP9)\b/i,
        /\b(AV1)\b/i
    ];
    
    // Patrones para codec de audio
    const patronesAudio = [
        /\b(AAC)\b/i,
        /\b(AC3|AC-3)\b/i,
        /\b(EAC3|E-AC-3)\b/i,
        /\b(FLAC)\b/i,
        /\b(DTS|DTS-HD)\b/i,
        /\b(Opus)\b/i
    ];
    
    // Buscar resolución
    for (const patron of patronesResolucion) {
        const match = nombre.match(patron);
        if (match) {
            resultado.resolucion = match[0];
            break;
        }
    }
    
    // Buscar fuente
    for (const patron of patronesFuente) {
        const match = nombre.match(patron);
        if (match) {
            resultado.fuente = match[0];
            break;
        }
    }
    
    // Buscar codec de video
    for (const patron of patronesCodec) {
        const match = nombre.match(patron);
        if (match) {
            resultado.codec = match[0];
            break;
        }
    }
    
    // Buscar codec de audio
    for (const patron of patronesAudio) {
        const match = nombre.match(patron);
        if (match) {
            resultado.audio = match[0];
            break;
        }
    }
    
    return resultado;
}

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Prueba la API: http://localhost:${PORT}/buscar-anime?nombre=one%20piece`);
    console.log(`Para especificar zona horaria: http://localhost:${PORT}/buscar-anime?nombre=one%20piece&timezone=America/Mexico_City`);
});
