import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import "./PromptDialog.scss";

type PromptOptions = {
  title: string;
  confirmLabel: string;
  defaultValue?: string;
  placeholder?: string;
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  /** styles the confirm button as destructive */
  danger?: boolean;
};

type DialogState = (
  | ({ type: "prompt" } & PromptOptions)
  | ({ type: "confirm" } & ConfirmOptions)
) & {
  resolve: (value: string | null) => void;
};

const PromptDialog = ({
  title,
  confirmLabel,
  onClose,
  ...options
}: DialogState & { onClose: (value: string | null) => void }) => {
  const withInput = options.type === "prompt";
  const defaultValue = (withInput && options.defaultValue) || "";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.select();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="notes-dialog"
      onCancel={(event) => {
        // Escape: let React unmount the dialog instead of the browser
        event.preventDefault();
        onClose(null);
      }}
      onClick={(event) => {
        // click on the backdrop
        if (event.target === dialogRef.current) {
          onClose(null);
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!withInput) {
            onClose("");
          } else if (value.trim()) {
            onClose(value.trim());
          }
        }}
      >
        <h2>{title}</h2>
        {options.type === "confirm" && options.message && (
          <p>{options.message}</p>
        )}
        {withInput && (
          <input
            ref={inputRef}
            value={value}
            placeholder={options.placeholder}
            aria-label={title}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <div className="notes-dialog__actions">
          <button type="button" onClick={() => onClose(null)}>
            Cancelar
          </button>
          <button
            type="submit"
            className={clsx("notes-dialog__confirm", {
              "notes-dialog__confirm--danger":
                options.type === "confirm" && options.danger,
            })}
            disabled={withInput && !value.trim()}
            autoFocus={!withInput}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
};

/**
 * In-app replacements for `window.prompt()` (which Electron, i.e. the macOS
 * app, doesn't support) and `window.confirm()`. Render `dialog`, then await
 * `prompt()` (trimmed text, or `null` when cancelled) or `confirm()`.
 */
export const usePromptDialog = () => {
  const [state, setState] = useState<DialogState | null>(null);

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setState({ type: "prompt", ...options, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({
          type: "confirm",
          ...options,
          resolve: (value) => resolve(value !== null),
        });
      }),
    [],
  );

  const dialog = state && (
    <PromptDialog
      {...state}
      onClose={(value) => {
        state.resolve(value);
        setState(null);
      }}
    />
  );

  return { prompt, confirm, dialog };
};
