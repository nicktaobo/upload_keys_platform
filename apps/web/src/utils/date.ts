const pad = (value: number) => String(value).padStart(2, "0");

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
