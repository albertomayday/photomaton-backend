// api.ts -- Photomaton frontend
const API_URL: string = (import.meta as any).env?.VITE_API_URL || 'https://photomaton-backend-621102657769.us-west1.run.app';

async function post(endpoint: string, body: object): Promise<any> {
  const res = await fetch(API_URL + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error('Backend ' + res.status + ': ' + txt);
  }
  return res.json();
}

export async function enhancePhoto(base64Image: string, mimeType: string, style: string): Promise<any> {
  return post('/generate', {
    image_base64: base64Image,
    style:        style,
    language:     'es'
  });
}

export async function checkHealth(): Promise<boolean> {
  try { return (await fetch(API_URL + '/health')).ok; } catch { return false; }
}
