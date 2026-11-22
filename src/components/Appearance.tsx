import { useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { Dialog } from "./Dialogs";

const options = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

declare global {
  interface Window {
    setReadingBoxAppearance: (value: (typeof options)[number]["value"]) => void;
  }
}
function subscribe(update: () => void) {
  window.addEventListener("appearancechange", update);
  return () => window.removeEventListener("appearancechange", update);
}

export function Appearance() {
  const [open, setOpen] = useState(false);
  const preference = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.appearance,
  );
  return (
    <>
      <button
        className="plain appearance-trigger"
        title="Appearance"
        aria-label="Appearance"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SunMoon />
        <span>Appearance</span>
      </button>
      {open && (
        <Dialog title="Appearance" onClose={() => setOpen(false)}>
          <fieldset className="appearance-options" aria-label="Colour theme">
            {options.map(({ value, label, Icon }) => (
              <label key={value}>
                <Icon aria-hidden="true" />
                <span>
                  {label}
                  {value === "system" && (
                    <small>Follow this device’s appearance</small>
                  )}
                </span>
                <input
                  type="radio"
                  name="appearance"
                  value={value}
                  aria-label={label}
                  checked={preference === value}
                  onChange={() => window.setReadingBoxAppearance(value)}
                />
              </label>
            ))}
          </fieldset>
        </Dialog>
      )}
    </>
  );
}
