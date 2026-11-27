import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function ManualCopy({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    text.current?.focus();
    text.current?.select();
  }, []);
  return (
    <Dialog title="Copy selected text" onClose={onClose}>
      <p>
        Clipboard access is unavailable. Use your device’s Copy command on the
        selected text.
      </p>
      <textarea aria-label="Text to copy" readOnly ref={text} value={value} />
    </Dialog>
  );
}
