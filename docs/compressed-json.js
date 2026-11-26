export async function readCompressedJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error('Archivo comprimido no disponible');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data[0] === 31 && data[1] === 139) {
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return JSON.parse(new TextDecoder().decode(data));
}
