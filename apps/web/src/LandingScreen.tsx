interface LandingScreenProps {
  onStart: () => void;
  dismissed: boolean;
}

export function LandingScreen({ onStart, dismissed }: LandingScreenProps) {
  if (dismissed) {
    return null;
  }

  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  return (
    <div
      role="dialog"
      aria-labelledby="landing-title"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#F4EAD5",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
        color: "#2B2118",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          maxWidth: 500,
          width: "100%",
          backgroundColor: "#FFF8E7",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 8px 32px rgba(43, 33, 24, 0.2)",
        }}
      >
        <h1
          id="landing-title"
          style={{
            fontSize: 48,
            margin: "0 0 16px 0",
            textAlign: "center",
            fontWeight: "normal",
          }}
        >
          DrawRace
        </h1>

        <p style={{ fontSize: 20, margin: "0 0 24px 0", textAlign: "center", lineHeight: 1.4 }}>
          Draw your wheel, race against ghosts!
        </p>

        <div style={{ marginBottom: 24, fontSize: 18, lineHeight: 1.5 }}>
          <strong>Install for the best experience:</strong>
          <ul style={{ margin: "12px 0", paddingLeft: 20 }}>
            <li>Faster loading</li>
            <li>Works offline</li>
            <li>Full-screen racing</li>
          </ul>
        </div>

        {isIOS && (
          <div style={{
            backgroundColor: "#E8DED0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 16
          }}>
            <strong>iPhone/iPad:</strong>
            <ol style={{ margin: "8px 0", paddingLeft: 20, lineHeight: 1.6 }}>
              <li>Tap the <strong>Share</strong> button <span aria-label="share icon">⎋</span></li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> to install</li>
            </ol>
          </div>
        )}

        {isAndroid && (
          <div style={{
            backgroundColor: "#E8DED0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 16
          }}>
            <strong>Android (Chrome):</strong>
            <ol style={{ margin: "8px 0", paddingLeft: 20, lineHeight: 1.6 }}>
              <li>Tap the <strong>⋮</strong> menu (top right)</li>
              <li>Tap <strong>Add to Home Screen</strong> or <strong>Install App</strong></li>
              <li>Tap <strong>Install</strong> to confirm</li>
            </ol>
          </div>
        )}

        {!isIOS && !isAndroid && (
          <div style={{
            backgroundColor: "#E8DED0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 16
          }}>
            <strong>Desktop:</strong>
            <p style={{ margin: "8px 0", lineHeight: 1.6 }}>
              Look for the install icon <span aria-label="install icon">+</span>
              in your browser&apos;s address bar, or download the app from your device&apos;s app store.
            </p>
          </div>
        )}

        <button
          onClick={onStart}
          style={{
            width: "100%",
            padding: "16px 32px",
            fontSize: 24,
            fontFamily: "inherit",
            backgroundColor: "#4A7C59",
            color: "#F4EAD5",
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
            transition: "transform 0.1s, backgroundColor 0.1s",
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "scale(0.97)";
            e.currentTarget.style.backgroundColor = "#3D6B4A";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.backgroundColor = "#4A7C59";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.backgroundColor = "#4A7C59";
          }}
        >
          Start Racing
        </button>

        <p style={{
          fontSize: 14,
          marginTop: 16,
          textAlign: "center",
          opacity: 0.7,
          margin: "16px 0 0 0"
        }}>
          You can always access this screen from Settings
        </p>
      </div>
    </div>
  );
}
