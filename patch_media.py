import re

with open('/root/knowledgebot/wa-server/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = "const media = await MessageMedia.fromUrl(fullMediaUrl, { unsafeMime: true });"
replacement = '''let media;
        try {
            media = await MessageMedia.fromUrl(fullMediaUrl, { unsafeMime: true });
        } catch (urlErr) {
            console.warn('[' + sessionName + '] MessageMedia.fromUrl fallo (' + urlErr.message + '), intentando fallback con fetch...');
            const fetchRes = await fetch(fullMediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
            if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status} al descargar media de ${fullMediaUrl}`);
            const arrayBuf = await fetchRes.arrayBuffer();
            const mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
            const base64Data = Buffer.from(arrayBuf).toString('base64');
            media = new MessageMedia(mimeType, base64Data, 'imagen.jpg');
        }'''

if target in content:
    new_content = content.replace(target, replacement)
    with open('/root/knowledgebot/wa-server/server.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("PATCH APPLIED SUCCESSFULLY")
else:
    print("TARGET NOT FOUND OR ALREADY PATCHED")
