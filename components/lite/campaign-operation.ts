export const LITE_CAMPAIGN_OPERATION_ID_PATTERN =
  /^campaign_[A-Za-z0-9_-]{16,64}$/;

export function createLiteCampaignOperationId(
  createUuid: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const operationId = `campaign_${createUuid()}`;
  if (!LITE_CAMPAIGN_OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error("A secure campaign operation ID could not be created.");
  }
  return operationId;
}
