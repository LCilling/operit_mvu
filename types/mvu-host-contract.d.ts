/**
 * Issue #998 host-contract aliases.
 *
 * Runtime declarations live in toolpkg.d.ts because these APIs are generic ToolPkg
 * capabilities rather than MVU-only globals. These aliases keep design documents and
 * contract tests readable without creating a second runtime namespace.
 */
declare namespace ToolPkgMvu {
  type OperitCharacterSummary = ToolPkg.ChatContextCharacterSnapshot;
  type OperitGroupMemberSummary = ToolPkg.ChatContextMemberSnapshot;
  type ActiveChatContext = ToolPkg.ChatContextSnapshot;

  interface MvuMessageIdentity {
    messageId: string;
    orderIndex: number;
    variantId: string | null;
    variantIndex: number;
  }

  type BackgroundModelProbe = ToolPkg.SystemModelProbeResult;
  type BackgroundModelRequest = ToolPkg.SystemModelCompletionRequest;
  type BackgroundModelResult = ToolPkg.SystemModelCompletionResult;
}
