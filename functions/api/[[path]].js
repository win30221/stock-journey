import { handleApi } from '../../backend/server/api.mjs';

export function onRequest(context) {
  return handleApi(context.request, context.env);
}
