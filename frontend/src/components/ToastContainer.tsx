import React from "react";
import { useToastStore } from "../lib/toastStore";
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from "lucide-react";

export const ToastContainer: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-2 sm:px-0"
    >
      {toasts.map((item) => {
        const isError = item.type === "error";
        const isWarning = item.type === "warning";
        const isSuccess = item.type === "success";

        return (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl shadow-md border text-xs transition-all ${
              isError
                ? "bg-slate-900 border-slate-800 text-white"
                : isWarning
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : isSuccess
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-white border-slate-200 text-slate-900"
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isError && <AlertCircle size={16} className="text-rose-400" />}
              {isWarning && <AlertTriangle size={16} className="text-amber-600" />}
              {isSuccess && <CheckCircle2 size={16} className="text-emerald-600" />}
              {!isError && !isWarning && !isSuccess && <Info size={16} className="text-blue-600" />}
            </div>

            <div className="flex-1">
              <h4 className="font-semibold text-xs leading-tight">{item.title}</h4>
              {item.message && <p className="mt-0.5 opacity-80 leading-snug">{item.message}</p>}
            </div>

            <button
              onClick={() => removeToast(item.id)}
              className="shrink-0 p-0.5 opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
              aria-label="Close notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
