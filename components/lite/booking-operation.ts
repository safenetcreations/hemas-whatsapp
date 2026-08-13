export const LITE_BOOKING_OPERATION_ID_PATTERN =
  /^booking_[A-Za-z0-9_-]{16,64}$/;

export function createLiteBookingOperationId(
  createUuid: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const operationId = `booking_${createUuid()}`;
  if (!LITE_BOOKING_OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error("A secure booking operation ID could not be created.");
  }
  return operationId;
}
