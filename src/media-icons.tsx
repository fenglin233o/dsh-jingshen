const paths = {
  phone: 'M7 3H4a1 1 0 0 0-1 1v1c0 8.84 7.16 16 16 16h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-.76-.97l-4-1a1 1 0 0 0-1.03.34l-1.63 2.04a13.04 13.04 0 0 1-6.99-6.99l2.04-1.63a1 1 0 0 0 .34-1.03l-1-4A1 1 0 0 0 7 3Z',
  hangup: 'M2.6 14.6a1.5 1.5 0 0 1 0-2.1 13 13 0 0 1 18.8 0 1.5 1.5 0 0 1 0 2.1l-1.8 1.8a1.2 1.2 0 0 1-1.6.1l-2.6-1.9a1.2 1.2 0 0 1-.5-1v-1.4a9 9 0 0 0-5.8 0v1.4a1.2 1.2 0 0 1-.5 1l-2.6 1.9a1.2 1.2 0 0 1-1.6-.1Z',
  camera: 'M15 10l5-3v10l-5-3m-1 5H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z',
  mic: 'M9 10V6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0v-1ZM5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6',
  muted: 'm3 3 18 18M9 9v2a3 3 0 0 0 4.5 2.6M9.8 4a3 3 0 0 1 5.2 2v4m-10 1a7 7 0 0 0 11 5.7m2.5-3.1c.3-.8.5-1.7.5-2.6M12 18v3m-3 0h6',
  stop: 'M7 7h10v10H7z',
}

export function MediaIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
