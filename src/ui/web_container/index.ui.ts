/**
 * MVU WebView container.
 *
 * The container owns resource loading and strict IPC forwarding only. Browser
 * history remains the sole UI navigation stack so leaving this route also
 * removes the full-screen WebView from Operit's composition.
 */
import type { ComposeDslContext, ComposeNode } from "../../../types/compose-dsl.js";
import { MVU_REQUEST_PARSERS, mvuIpcClient } from "../../shared/ipc.js";

type JsonParams = Record<string, unknown>;

export default function Screen(ctx: ComposeDslContext): ComposeNode {
  const controller = ctx.createWebViewController("mvu_web");
  const bridgeInstalled = ctx.useRef("mvu_web_bridge_installed", false);
  const resourceLoadStarted = ctx.useRef("mvu_web_resource_load_started", false);
  const [appUrl, setAppUrl] = ctx.useState("mvu_web_app_url", "");
  const [resourceError, setResourceError] = ctx.useState("mvu_web_resource_error", "");

  if (!bridgeInstalled.current) {
    bridgeInstalled.current = true;
    controller.addJavascriptInterface("NativeMvu", {
      call: (bridgeArguments: readonly unknown[]): void => {
        let request: ReturnType<typeof parseBridgeArguments>;
        try {
          request = parseBridgeArguments(bridgeArguments);
        } catch (error) {
          console.error("MVU browser bridge arguments invalid", error);
          const callbackId = readRejectedRequestCallbackId(bridgeArguments);
          if (callbackId !== null) {
            void rejectBrowserCall(controller, callbackId, requireError(error)).catch(
              (deliveryError: unknown) => {
                console.error("MVU browser bridge rejection delivery failed", deliveryError);
              }
            );
          }
          return;
        }
        void dispatch(request.method, request.params)
          .then((result) => resolveBrowserCall(controller, request.callbackId, result))
          .catch((error: unknown) =>
            rejectBrowserCall(controller, request.callbackId, requireError(error))
          )
          .catch((deliveryError: unknown) =>
            console.error("MVU browser bridge callback delivery failed", deliveryError)
          );
      },
    });
  }

  async function loadAppResource(): Promise<void> {
    if (resourceLoadStarted.current) return;
    resourceLoadStarted.current = true;
    try {
      const filePath = await ToolPkg.readResource("app_html", "operit_mvu-app.html");
      if (!filePath.trim()) throw new Error("MVU_APP_RESOURCE_PATH_EMPTY");
      setAppUrl(`file://${filePath}`);
    } catch (error) {
      console.error("MVU app.html resource load failed", error);
      setResourceError("动态状态页面资源装载失败");
      void ctx.reportError(error);
    }
  }

  return ctx.UI.Box(
    {
      fillMaxSize: true,
      backgroundColor: "#F8F8FC",
      contentAlignment: "center",
      onLoad: loadAppResource,
    },
    appUrl
      ? ctx.UI.WebView({
          key: "mvu_web",
          controller,
          url: appUrl,
          javaScriptEnabled: true,
          domStorageEnabled: true,
          allowFileAccess: true,
          // Character avatars may be explicit content:// URIs from Android document providers.
          // Universal file-URL access stays disabled; only content-resolver reads are enabled.
          allowContentAccess: true,
          allowFileAccessFromFileURLs: true,
          allowUniversalAccessFromFileURLs: false,
          supportZoom: false,
          builtInZoomControls: false,
          displayZoomControls: false,
          useWideViewPort: false,
          loadWithOverviewMode: false,
          textZoom: 100,
          fillMaxSize: true,
        })
      : ctx.UI.Text({
          text: resourceError ? resourceError : "正在装载动态状态页面…",
          style: "bodyMedium",
          color: resourceError ? "#D93464" : "#626C8C",
        })
  );
}

function parseBridgeArguments(bridgeArguments: readonly unknown[]): {
  method: string;
  params: JsonParams;
  callbackId: number;
} {
  if (!Array.isArray(bridgeArguments) || bridgeArguments.length !== 3) {
    throw new Error("MVU_BRIDGE_ARGUMENTS_INVALID");
  }
  const method = bridgeArguments[0];
  const encodedParams = bridgeArguments[1];
  const callbackId = bridgeArguments[2];
  if (typeof method !== "string") throw new Error("MVU_BRIDGE_METHOD_INVALID");
  if (typeof encodedParams !== "string") throw new Error("MVU_BRIDGE_PARAMS_INVALID");
  if (typeof callbackId !== "number" || !Number.isSafeInteger(callbackId)) {
    throw new Error("MVU_BRIDGE_CALLBACK_INVALID");
  }
  const parsed: unknown = JSON.parse(encodedParams);
  if (!isRecord(parsed)) throw new Error("MVU_BRIDGE_PARAMS_NOT_OBJECT");
  return { method, params: parsed, callbackId };
}

function readRejectedRequestCallbackId(bridgeArguments: readonly unknown[]): number | null {
  if (!Array.isArray(bridgeArguments) || bridgeArguments.length !== 3) return null;
  const callbackId = bridgeArguments[2];
  if (typeof callbackId !== "number" || !Number.isSafeInteger(callbackId)) return null;
  return callbackId;
}

async function dispatch(method: string, params: JsonParams): Promise<unknown> {
  switch (method) {
    case "snapshot":
      return mvuIpcClient.snapshot(MVU_REQUEST_PARSERS.snapshot(params));
    case "setStateValue":
      return mvuIpcClient.setStateValue(MVU_REQUEST_PARSERS.setStateValue(params));
    case "addField":
      return mvuIpcClient.addField(MVU_REQUEST_PARSERS.addField(params));
    case "updateField":
      return mvuIpcClient.updateField(MVU_REQUEST_PARSERS.updateField(params));
    case "deleteField":
      return mvuIpcClient.deleteField(MVU_REQUEST_PARSERS.deleteField(params));
    case "settleNatural":
      return mvuIpcClient.settleNatural(MVU_REQUEST_PARSERS.settleNatural(params));
    case "addLinkRule":
      return mvuIpcClient.addLinkRule(MVU_REQUEST_PARSERS.addLinkRule(params));
    case "updateLinkRule":
      return mvuIpcClient.updateLinkRule(MVU_REQUEST_PARSERS.updateLinkRule(params));
    case "deleteLinkRule":
      return mvuIpcClient.deleteLinkRule(MVU_REQUEST_PARSERS.deleteLinkRule(params));
    case "addAutoRule":
      return mvuIpcClient.addAutoRule(MVU_REQUEST_PARSERS.addAutoRule(params));
    case "updateAutoRule":
      return mvuIpcClient.updateAutoRule(MVU_REQUEST_PARSERS.updateAutoRule(params));
    case "deleteAutoRule":
      return mvuIpcClient.deleteAutoRule(MVU_REQUEST_PARSERS.deleteAutoRule(params));
    case "updateSettings":
      return mvuIpcClient.updateSettings(MVU_REQUEST_PARSERS.updateSettings(params));
    case "probeModel":
      return mvuIpcClient.probeModel(MVU_REQUEST_PARSERS.probeModel(params));
    case "judgeState":
      return mvuIpcClient.judgeState(MVU_REQUEST_PARSERS.judgeState(params));
    case "exportDataset":
      return mvuIpcClient.exportDataset(MVU_REQUEST_PARSERS.exportDataset(params));
    case "importDataset":
      return mvuIpcClient.importDataset(MVU_REQUEST_PARSERS.importDataset(params));
    case "addTemporaryEffect":
      return mvuIpcClient.addTemporaryEffect(MVU_REQUEST_PARSERS.addTemporaryEffect(params));
    case "updateTemporaryEffect":
      return mvuIpcClient.updateTemporaryEffect(MVU_REQUEST_PARSERS.updateTemporaryEffect(params));
    case "deleteTemporaryEffect":
      return mvuIpcClient.deleteTemporaryEffect(MVU_REQUEST_PARSERS.deleteTemporaryEffect(params));
    case "queryFields":
      return mvuIpcClient.queryFields(MVU_REQUEST_PARSERS.queryFields(params));
    case "queryActors":
      return mvuIpcClient.queryActors(MVU_REQUEST_PARSERS.queryActors(params));
    case "queryGroups":
      return mvuIpcClient.queryGroups(MVU_REQUEST_PARSERS.queryGroups(params));
    case "queryRules":
      return mvuIpcClient.queryRules(MVU_REQUEST_PARSERS.queryRules(params));
    case "queryConditions":
      return mvuIpcClient.queryConditions(MVU_REQUEST_PARSERS.queryConditions(params));
    case "queryEffectGroups":
      return mvuIpcClient.queryEffectGroups(MVU_REQUEST_PARSERS.queryEffectGroups(params));
    case "queryRecords":
      return mvuIpcClient.queryRecords(MVU_REQUEST_PARSERS.queryRecords(params));
    case "getEntityById":
      return mvuIpcClient.getEntityById(MVU_REQUEST_PARSERS.getEntityById(params));
    case "createCondition":
      return mvuIpcClient.createCondition(MVU_REQUEST_PARSERS.createCondition(params));
    case "updateCondition":
      return mvuIpcClient.updateCondition(MVU_REQUEST_PARSERS.updateCondition(params));
    case "copyCondition":
      return mvuIpcClient.copyCondition(MVU_REQUEST_PARSERS.copyCondition(params));
    case "toggleCondition":
      return mvuIpcClient.toggleCondition(MVU_REQUEST_PARSERS.toggleCondition(params));
    case "deleteCondition":
      return mvuIpcClient.deleteCondition(MVU_REQUEST_PARSERS.deleteCondition(params));
    case "getConditionReferences":
      return mvuIpcClient.getConditionReferences(MVU_REQUEST_PARSERS.getConditionReferences(params));
    case "createEffectGroup":
      return mvuIpcClient.createEffectGroup(MVU_REQUEST_PARSERS.createEffectGroup(params));
    case "updateEffectGroup":
      return mvuIpcClient.updateEffectGroup(MVU_REQUEST_PARSERS.updateEffectGroup(params));
    case "copyEffectGroup":
      return mvuIpcClient.copyEffectGroup(MVU_REQUEST_PARSERS.copyEffectGroup(params));
    case "toggleEffectGroup":
      return mvuIpcClient.toggleEffectGroup(MVU_REQUEST_PARSERS.toggleEffectGroup(params));
    case "deleteEffectGroup":
      return mvuIpcClient.deleteEffectGroup(MVU_REQUEST_PARSERS.deleteEffectGroup(params));
    case "getEffectGroupReferences":
      return mvuIpcClient.getEffectGroupReferences(MVU_REQUEST_PARSERS.getEffectGroupReferences(params));
    case "createRule":
      return mvuIpcClient.createRule(MVU_REQUEST_PARSERS.createRule(params));
    case "updateRule":
      return mvuIpcClient.updateRule(MVU_REQUEST_PARSERS.updateRule(params));
    case "copyRule":
      return mvuIpcClient.copyRule(MVU_REQUEST_PARSERS.copyRule(params));
    case "toggleRule":
      return mvuIpcClient.toggleRule(MVU_REQUEST_PARSERS.toggleRule(params));
    case "deleteRule":
      return mvuIpcClient.deleteRule(MVU_REQUEST_PARSERS.deleteRule(params));
    case "getRuleReferences":
      return mvuIpcClient.getRuleReferences(MVU_REQUEST_PARSERS.getRuleReferences(params));
    default:
      throw new Error(`MVU_BRIDGE_METHOD_UNKNOWN:${method}`);
  }
}

function isRecord(value: unknown): value is JsonParams {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error("MVU_BRIDGE_NON_ERROR_REJECTION");
}

async function resolveBrowserCall(
  controller: ReturnType<ComposeDslContext["createWebViewController"]>,
  callbackId: number,
  result: unknown
): Promise<void> {
  const payload = JSON.stringify(result === undefined ? null : result);
  await controller.evaluateJavascript(`window.__mvuResolve(${callbackId}, ${payload});`);
}

async function rejectBrowserCall(
  controller: ReturnType<ComposeDslContext["createWebViewController"]>,
  callbackId: number,
  error: Error
): Promise<void> {
  console.error("MVU browser bridge request failed", error);
  await controller.evaluateJavascript(
    `window.__mvuReject(${callbackId}, ${JSON.stringify(error.message)});`
  );
}
