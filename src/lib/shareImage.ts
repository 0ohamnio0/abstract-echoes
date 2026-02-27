export async function uploadToImgbb(dataUrl: string): Promise<string> {
  const apiKey = import.meta.env.VITE_IMGBB_API_KEY;
  if (!apiKey) throw new Error('VITE_IMGBB_API_KEY not set');

  const base64 = dataUrl.split(',')[1];
  const form = new FormData();
  form.append('image', base64);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) throw new Error(`imgbb upload failed: ${res.status}`);

  const json = await res.json();
  return json.data.url as string;
}
