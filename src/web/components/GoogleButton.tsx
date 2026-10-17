import { useEffect, useRef, useState } from 'react';

// Google Identity Services. The script is loaded only when an admin has
// configured a client id, so sites without Google sign-in never contact Google.

interface GoogleId {
  initialize(options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    nonce?: string;
  }): void;
  renderButton(element: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let loading: Promise<void> | undefined;

function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = undefined;
      reject(new Error('無法載入 Google 登入元件'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function GoogleButton(props: {
  clientId: string;
  onToken: (idToken: string) => void;
  label?: 'signin_with' | 'continue_with';
  /** Backend challenge Google puts into the token; a new one re-arms the button. */
  nonce?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const { clientId, onToken, label, nonce } = props;

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          // A button that has gone away (page left, new challenge) is void.
          callback: (response) => !cancelled && response.credential && onToken(response.credential),
          ...(nonce ? { nonce } : {}),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'outline',
          size: 'large',
          text: label ?? 'signin_with',
        });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, onToken, label, nonce]);

  return error ? <p className="neg">{error}</p> : <div ref={ref} />;
}
