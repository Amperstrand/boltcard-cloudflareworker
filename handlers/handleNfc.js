import { htmlResponse } from "../utils/responses.js";
import { renderNfcPage } from "../templates/nfcPage.js";

export default async function handleNfc() {
  return htmlResponse(renderNfcPage());
}
