export function calculateBackoff(retryCount) {
  return Math.pow(2, retryCount) * 1000;
}
