import { toast } from 'sonner';

export function toastSuccess(message) {
  toast.success(message);
}

export function toastError(message) {
  toast.error(message);
}
