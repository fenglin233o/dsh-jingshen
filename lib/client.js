window.__ModuleLoader__.load({
	id: "dsh-jingshen",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/style.css?raw
		var style_default = "/* Host theme tokens also work when this panel is opened beside a native Session. */\n.spirit { --sp-text: var(--dsw-alias-label-primary, #23272f); --sp-muted: var(--dsw-alias-label-tertiary, #647084); --sp-line: var(--dsw-alias-border-l3, #dfe3ea); --sp-bg: var(--dsw-alias-bg-layer-1, #fff); --sp-hover: var(--dsw-alias-interactive-bg-hover, #f0f3f8); --sp-brand: var(--dsw-alias-brand-primary, #3868d8); --sp-error: var(--dsw-alias-state-error-primary, #ba3131); --sp-warn: var(--dsw-alias-state-warn-primary, #997000); box-sizing: border-box; height: 100%; min-height: 100%; overflow: auto; scrollbar-gutter: stable; container-type: inline-size; color: var(--sp-text); background: var(--sp-bg); font: 14px/1.65 var(--ds-font-family-body, system-ui, sans-serif); padding: 28px clamp(18px, 4vw, 48px) 40px; }\n.spirit *, .spirit *::before, .spirit *::after { box-sizing: border-box; }\n.spirit-content { max-width: 1120px; margin: 0 auto; }\n.spirit-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }\n[data-platform='darwin'] .spirit-header { padding-top: var(--dsh-frame-top-clearance, 0px); }\n.spirit h1 { margin: 0; font-size: 24px; line-height: 1.4; font-weight: 600; letter-spacing: .02em; }\n.spirit h2 { margin: 0 0 10px; font-size: 16px; font-weight: 600; }\n.spirit h3 { margin: 0; font-size: 14px; font-weight: 600; }\n.spirit h4 { margin: 16px 0 6px; font-size: 13px; font-weight: 600; }\n.spirit p { margin: 8px 0; overflow-wrap: anywhere; }\n.spirit small { font-size: 12px; color: var(--sp-muted); }\n.spirit .spirit-muted { color: var(--sp-muted); font-size: 13px; }\n.spirit .spirit-prose { white-space: pre-wrap; overflow-wrap: anywhere; }\n.spirit button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; min-height: 34px; padding: 5px 11px; border: 1px solid var(--sp-line); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }\n.spirit button:hover:not(:disabled) { background: var(--sp-hover); }\n.spirit button:focus-visible, .spirit input:focus-visible, .spirit summary:focus-visible, .spirit-tabpanel:focus-visible { outline: 2px solid var(--sp-brand); outline-offset: 3px; }\n.spirit button:disabled, .spirit fieldset:disabled { opacity: .5; cursor: default; }\n.spirit button.spirit-primary { background: var(--sp-brand); border-color: var(--sp-brand); color: var(--dsw-static-neutral-bluish-00, #fff); }\n.spirit button.spirit-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--sp-brand) 90%, var(--sp-text)); }\n.spirit button.spirit-danger { color: var(--sp-error); }\n.spirit-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }\n.spirit-overview { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 16px; }\n.spirit-card { padding: 18px 20px; border: 1px solid var(--sp-line); border-radius: 14px; min-width: 0; }\n.spirit .spirit-runtime-title { display: flex; align-items: center; gap: 9px; margin: 16px 0 10px; font-size: 20px; font-weight: 500; }\n.spirit-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--sp-muted); }\n.spirit-dot[data-state='running'] { background: var(--dsw-alias-state-success-primary, #24874d); }\n.spirit-dot[data-state='paused'] { background: var(--sp-warn); }\n.spirit-runtime > .spirit-actions { margin-top: 16px; }\n.spirit-attention-text { color: var(--sp-warn); }\n.spirit-recovery { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--sp-line); font-size: 13px; }\n.spirit-permission-status { font-size: 13px; color: var(--sp-muted); }\n.spirit-permission-status[role='alert'] { color: var(--sp-error); }\n.spirit fieldset { min-width: 0; border: 0; margin: 12px 0; padding: 0; display: grid; gap: 8px; }\n.spirit-permission-option { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--sp-line); border-radius: 9px; cursor: pointer; }\n.spirit-permission-option:has(input:checked) { border-color: var(--sp-brand); background: color-mix(in srgb, var(--sp-brand) 6%, transparent); }\n.spirit-permission-option input { accent-color: var(--sp-brand); margin: 5px 0 0; width: 15px; height: 15px; flex: none; }\n.spirit-permission-option strong { display: block; font-size: 13px; font-weight: 500; }\n.spirit-permission-option small { display: block; }\n.spirit .spirit-scope { font-size: 12px; }\n.spirit-permissions form > .spirit-actions { margin-top: 12px; }\n.spirit-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; margin-bottom: 14px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--sp-error) 30%, transparent); background: color-mix(in srgb, var(--sp-error) 6%, transparent); font-size: 13px; overflow-wrap: anywhere; }\n.spirit-error > button { flex: none; }\n.spirit-error p { margin: 3px 0; }\n.spirit-overview + .spirit-error { margin-top: 16px; }\n.spirit-live { color: var(--sp-muted); font-size: 13px; }\n.spirit-live:not(:empty) { margin: 0 0 12px; }\n.spirit-tabs { display: flex; gap: 20px; overflow-x: auto; border-bottom: 1px solid var(--sp-line); margin-top: 24px; padding: 0 2px; }\n.spirit .spirit-tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; white-space: nowrap; padding: 10px 0; min-height: 44px; color: var(--sp-muted); }\n.spirit .spirit-tabs button[aria-selected='true'] { border-bottom-color: var(--sp-brand); color: var(--sp-text); font-weight: 500; }\n.spirit-tabs span { padding-left: 4px; color: var(--sp-muted); font-size: 12px; font-variant-numeric: tabular-nums; }\n.spirit-tabpanel { min-width: 0; padding-top: 20px; border-radius: 4px; }\n.spirit-section { min-width: 0; margin-bottom: 26px; }\n.spirit-section:last-child { margin-bottom: 0; }\n.spirit-record { min-width: 0; padding: 16px; border: 1px solid var(--sp-line); border-radius: 12px; margin-top: 12px; }\n.spirit-record-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }\n.spirit-record-heading h3 { flex: 1; min-width: 0; overflow-wrap: anywhere; }\n.spirit-record-heading h2 { margin-top: 8px; }\n.spirit-tag { display: inline-flex; flex: none; align-items: center; padding: 1px 7px; border: 1px solid var(--sp-line); border-radius: 6px; color: var(--sp-muted); font-size: 11px; line-height: 18px; }\n.spirit-record-meta { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; color: var(--sp-muted); font-size: 12px; overflow-wrap: anywhere; }\n.spirit button.spirit-link { border: 0; min-height: 28px; padding: 2px 0; color: var(--dsw-alias-link, var(--sp-brand)); font-size: 12px; }\n.spirit button.spirit-link:hover:not(:disabled) { background: none; text-decoration: underline; }\n.spirit-attention { padding: 12px 14px; margin: 12px 0; border-radius: 9px; background: color-mix(in srgb, var(--sp-warn) 10%, transparent); }\n.spirit-timeline { list-style: none; padding: 0; margin: 0; }\n.spirit-timeline li { padding: 12px 0; border-bottom: 1px solid var(--sp-line); }\n.spirit-timeline li:last-child { border-bottom: 0; }\n.spirit-timeline p:first-child { margin-top: 0; }\n.spirit-session-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }\n.spirit-session-list .spirit-record { margin-top: 0; }\n.spirit-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 12px 0; font-size: 12px; }\n.spirit-meta dt { color: var(--sp-muted); }\n.spirit-meta dd { margin: 0; overflow-wrap: anywhere; }\n.spirit-columns { display: grid; grid-template-columns: minmax(170px, 240px) minmax(0, 1fr); gap: 24px; }\n.spirit-columns aside { border-right: 1px solid var(--sp-line); padding-right: 16px; min-width: 0; }\n.spirit-columns aside button { display: block; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 8px; }\n.spirit-columns aside button[aria-pressed='true'] { background: var(--sp-hover); border-color: var(--sp-brand); }\n.spirit-columns aside strong { display: block; font-weight: 500; overflow-wrap: anywhere; }\n.spirit-columns aside small { display: block; margin-top: 4px; }\n.spirit-task { min-width: 0; }\n.spirit-task > .spirit-record-heading { margin-bottom: 18px; }\n.spirit-task .spirit-section { margin: 20px 0; }\n.spirit-task .spirit-section h3 { margin-bottom: 8px; }\n.spirit details { min-width: 0; border: 1px solid var(--sp-line); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }\n.spirit summary { cursor: pointer; font-size: 13px; overflow-wrap: anywhere; }\n.spirit details ul { padding-left: 22px; overflow-wrap: anywhere; }\n.spirit-history-check { border-left: 2px solid var(--sp-line); padding-left: 12px; font-size: 13px; }\n.spirit-activation { border-left: 2px solid var(--sp-line); padding-left: 12px; margin: 14px 0; font-size: 13px; }\n.spirit-activation [role='alert'] { color: var(--sp-error); }\n.spirit-memory-text { margin: 10px 0 16px; font-size: 14px; }\n.spirit-empty { padding: 44px 12px; color: var(--sp-muted); max-width: 640px; }\n.spirit-empty h2 { color: var(--sp-text); }\n.spirit-empty-inline { padding: 20px 0; color: var(--sp-muted); font-size: 13px; }\n.spirit-footer { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--sp-line); margin-top: 28px; padding-top: 16px; }\n.spirit-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }\n@container (max-width: 760px) {\n  .spirit-overview { grid-template-columns: 1fr; }\n  .spirit-session-list { grid-template-columns: 1fr; }\n  .spirit-columns { grid-template-columns: 1fr; gap: 16px; }\n  .spirit-columns aside { display: flex; gap: 8px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--sp-line); padding: 0 0 10px; }\n  .spirit-columns aside button { min-width: 160px; max-width: 240px; margin: 0; }\n  .spirit-card { padding: 16px; }\n}\n@media (max-width: 600px) {\n  .spirit { padding: 20px 16px 32px; }\n  .spirit-header { flex-direction: column; }\n  .spirit-header > .spirit-actions { width: 100%; }\n  .spirit-header > .spirit-actions .spirit-primary { flex: 1; }\n  .spirit-tabs { gap: 18px; }\n  .spirit button { min-height: 40px; }\n  .spirit-error { align-items: flex-start; flex-direction: column; }\n}\n";
		// src/client.tsx
		const tabs = [
			{
				id: "activity",
				label: "活动"
			},
			{
				id: "sessions",
				label: "会话"
			},
			{
				id: "tasks",
				label: "事情"
			},
			{
				id: "memory",
				label: "记忆"
			},
			{
				id: "changes",
				label: "自身改动"
			}
		];
		const labels = {
			progress: "进行中",
			waiting: "等待继续",
			ready: "已交付",
			blocked: "等待决定",
			failed: "受阻",
			dropped: "已结束",
			stopped: "已停止",
			completed: "已完成",
			pending: "等待执行",
			running: "进行中",
			ended: "已结束",
			idle: "空闲",
			busy: "运行中",
			paused: "已暂停",
			proposed: "待考虑",
			active: "推进中",
			dismissed: "已搁置",
			accepted: "已采纳",
			rejected: "未采纳",
			planned: "已计划",
			applied: "已应用",
			verified: "已验证",
			rolled_back: "已回退",
			interrupted: "曾中断",
			recovered: "已恢复",
			error: "发生错误",
			stored: "已保存",
			awaiting_decision: "等待判断",
			retry: "等待重试"
		};
		const changeStates = {
			candidate: "候选改动",
			"checkpoint-failed": "备份失败",
			verifying: "正在验证",
			verified: "验证通过",
			"verification-failed": "验证未通过",
			applying: "正在应用文件",
			"apply-failed": "文件应用失败",
			applied: "文件已应用",
			"rolling-back": "正在回退文件",
			"rollback-conflict": "回退遇到冲突",
			"rollback-failed": "文件回退失败",
			"rolled-back": "文件已回退"
		};
		const activationStates = {
			requested: "等待加载",
			"restart-required": "需要重新启动",
			restarting: "正在重启",
			booting: "正在启动",
			"runtime-loaded": "运行版本已加载",
			failed: "加载失败",
			cancelled: "已取消加载"
		};
		const memoryStates = {
			proposed: "待接纳",
			active: "自主保留",
			accepted: "本人已确认",
			rejected: "未接纳",
			superseded: "已修订",
			forgotten: "已遗忘"
		};
		const memoryKinds = {
			preference: "偏好",
			fact: "事实",
			practice: "方法"
		};
		const permissionLabels = {
			full: "完全访问",
			ask: "敏感操作询问"
		};
		const message = (error) => error instanceof Error ? error.message : String(error);
		const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
		function dateLabel(value) {
			const date = new Date(value);
			return Number.isFinite(date.getTime()) ? date.toLocaleString() : value || "时间未记录";
		}
		function SessionArrow() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				"aria-hidden": "true",
				focusable: "false",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4 12 12 4M4 4h8v8",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		async function request(path, data, signal) {
			const controller = new AbortController();
			const abort = () => controller.abort();
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			const timeout = setTimeout(abort, 2e4);
			try {
				const response = await fetch(`/personal-spirit/api/${path}`, {
					method: data === void 0 ? "GET" : "POST",
					credentials: "same-origin",
					signal: controller.signal,
					headers: {
						"x-personal-spirit": "1",
						...data === void 0 ? {} : { "content-type": "application/json" }
					},
					...data === void 0 ? {} : { body: JSON.stringify(data) }
				});
				let result;
				try {
					result = await response.json();
				} catch {
					throw new Error(response.ok ? "服务返回了无法读取的数据，请重试。" : `请求失败（HTTP ${response.status}），请重试。`);
				}
				if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : `请求失败（HTTP ${response.status}）`);
				return result;
			} catch (error) {
				if (controller.signal.aborted && !signal?.aborted) throw new Error("请求超时，当前状态尚未确认。请刷新后查看。");
				throw error;
			} finally {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
			}
		}
		/** Refuse an incompatible response instead of rendering a blank panel or claiming a permission mode. */
		function readState(value) {
			if (!isRecord(value) || typeof value.mainId !== "string" || !value.mainId || !Array.isArray(value.tasks) || !Array.isArray(value.memories) || !isRecord(value.health) || typeof value.busy !== "number") throw new Error("面板状态不完整，请刷新或检查精神服务。");
			if (value.tasks.some((item) => !isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.sessionId !== "string" || !Array.isArray(item.assignments)) || value.memories.some((item) => !isRecord(item) || typeof item.id !== "string" || typeof item.statement !== "string" || typeof item.state !== "string")) throw new Error("记录格式无法读取，请检查精神服务。");
			if (value.permissions !== void 0 && (!isRecord(value.permissions) || !["full", "ask"].includes(String(value.permissions.mode)) || ![
				"applied",
				"pending",
				"error"
			].includes(String(value.permissions.status)))) throw new Error("权限状态无法读取，尚未确认当前权限。");
			if (value.autonomy !== void 0 && (!isRecord(value.autonomy) || ![
				"running",
				"paused",
				"stopped"
			].includes(String(value.autonomy.state)))) throw new Error("运行状态无法读取，请刷新后查看。");
			for (const key of [
				"sessions",
				"intentions",
				"activity",
				"changes"
			]) if (value[key] !== void 0 && (!Array.isArray(value[key]) || value[key].some((item) => !isRecord(item) || typeof item.id !== "string"))) throw new Error("活动记录无法读取，请刷新后查看。");
			if (value.activation !== void 0 && (!isRecord(value.activation) || !Array.isArray(value.activation.receipts) || value.activation.receipts.some((item) => !isRecord(item) || typeof item.id !== "string" || typeof item.changeId !== "string" || typeof item.requestedAt !== "string" || typeof item.updatedAt !== "string" || typeof item.status !== "string" || !Object.hasOwn(activationStates, item.status)))) throw new Error("运行加载回执无法读取，请刷新后查看。");
			return value;
		}
		function Activation({ change, receipts }) {
			const receipt = receipts?.filter((item) => item.changeId === change.id).reduce((latest, item) => !latest || item.requestedAt >= latest.requestedAt ? item : latest, void 0);
			if (!receipt && !change.activation?.length) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "spirit-activation",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "最近加载回执" }),
					" · ",
					receipt ? activationStates[receipt.status] : "尚无加载回执"
				] }), receipt ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					receipt.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "spirit-prose",
						role: receipt.status === "failed" ? "alert" : void 0,
						children: receipt.error
					}),
					receipt.runtime?.version && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "spirit-muted",
						children: ["加载版本：", receipt.runtime.version]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: ["回执更新：", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
						dateTime: receipt.updatedAt,
						children: dateLabel(receipt.updatedAt)
					})] })
				] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "spirit-muted",
					children: change.activation?.some((item) => item.required === "host-restart") ? "改动应用后还需请求重启宿主，加载结果将记录在这里。" : "改动应用后还需请求加载插件，加载结果将记录在这里。"
				})]
			});
		}
		function History({ experience }) {
			if (!experience) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "spirit-history",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "历史经验记录" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "spirit-muted",
						children: "保留当时的材料、判断和修改原因，便于回看。"
					}),
					!experience.frames.length && !experience.evidence.length && !experience.reflections?.length && !experience.results?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "spirit-muted",
						children: "尚无历史经验记录。"
					}),
					experience.reflections?.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [dateLabel(item.at), " · 留下的认识"] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "spirit-prose",
							children: item.new
						}),
						item.previous && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-prose",
							children: ["此前的理解：", item.previous]
						}),
						item.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-prose",
							children: ["调整原因：", item.reason]
						}),
						item.check && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-prose",
							children: ["检验情况：", item.check]
						}),
						item.limits && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-muted spirit-prose",
							children: ["尚有限制：", item.limits]
						})
					] }, item.id)),
					experience.results?.map((result, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [dateLabel(result.at), " · 当时的成果"] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "spirit-prose",
							children: result.text
						}),
						result.check && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-prose",
							children: ["检验情况：", result.check]
						}),
						result.limits && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-muted spirit-prose",
							children: ["尚有限制：", result.limits]
						})
					] }, `${result.at}:${index}`)),
					experience.frames.map((frame) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [dateLabel(frame.at), " · 当时的判断"] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "spirit-prose",
							children: frame.object
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: frame.claims.map((claim) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: claim.statement }, claim.id)) }),
						frame.limits && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-muted",
							children: ["尚有限制：", frame.limits]
						}),
						frame.transition && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "spirit-prose",
							children: ["调整原因：", frame.transition.reason]
						}),
						!!frame.criteria.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "当时的检验依据" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: frame.criteria.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: item.text }, item.id)) })] }),
						experience.examinations.filter((exam) => exam.frame === frame.number).map((exam) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "spirit-history-check",
							children: [exam.checks.map((check) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								check.outcome === "met" ? "符合" : check.outcome === "unmet" ? "不符合" : "尚不清楚",
								" · ",
								frame.criteria.find((item) => item.id === check.criterionId)?.text,
								"：",
								check.reason
							] }, check.criterionId)), [...exam.contradictions, ...exam.criterionContradictions].map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["发现的问题：", item.reason] }, index))]
						}, exam.id))
					] }, frame.number)),
					!!experience.evidence.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "留下的材料" }), experience.evidence.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: item.reference }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "spirit-prose",
							children: item.content
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: dateLabel(item.at) })
					] }, item.id))] })
				]
			});
		}
		function Panel({ openSession }) {
			const [state, setState] = (0, react.useState)(), [readError, setReadError] = (0, react.useState)(""), [actionError, setActionError] = (0, react.useState)("");
			const [selected, setSelected] = (0, react.useState)(), [tab, setTab] = (0, react.useState)("activity");
			const [pending, setPending] = (0, react.useState)(), [reloading, setReloading] = (0, react.useState)(false), [notice, setNotice] = (0, react.useState)("");
			const [permissionDraft, setPermissionDraft] = (0, react.useState)(), [updatedAt, setUpdatedAt] = (0, react.useState)();
			const live = (0, react.useRef)(false), sequence = (0, react.useRef)(0), acting = (0, react.useRef)(false), fetching = (0, react.useRef)(false), life = (0, react.useRef)();
			const panelId = (0, react.useId)();
			const refresh = (0, react.useCallback)(async () => {
				const id = ++sequence.current;
				fetching.current = true;
				try {
					const next = readState(await request("state", void 0, life.current?.signal));
					if (live.current && id === sequence.current) {
						setState(next);
						setReadError("");
						setUpdatedAt((/* @__PURE__ */ new Date()).toISOString());
					}
					return next;
				} catch (error) {
					if (live.current && id === sequence.current) setReadError(message(error));
					throw error;
				} finally {
					if (id === sequence.current) fetching.current = false;
				}
			}, []);
			(0, react.useEffect)(() => {
				live.current = true;
				life.current = new AbortController();
				refresh().catch(() => {});
				const timer = setInterval(() => {
					if (!acting.current && !fetching.current) refresh().catch(() => {});
				}, 5e3);
				return () => {
					live.current = false;
					sequence.current++;
					life.current?.abort();
					clearInterval(timer);
				};
			}, [refresh]);
			const retry = async () => {
				if (reloading) return;
				setReloading(true);
				try {
					await refresh();
				} catch {} finally {
					if (live.current) setReloading(false);
				}
			};
			const act = async (key, action, success = "", reload = true) => {
				if (acting.current) return false;
				acting.current = true;
				sequence.current++;
				fetching.current = false;
				setPending(key);
				setActionError("");
				setNotice("");
				let submitted = false;
				try {
					await action();
					submitted = true;
					if (!live.current) return false;
					if (reload) await refresh();
					if (live.current) setNotice(success);
					return true;
				} catch (error) {
					if (reload && !submitted && live.current) try {
						await refresh();
					} catch {}
					if (live.current) setActionError(`${submitted && reload ? "操作已提交，最新状态尚未确认：" : ""}${message(error)}`);
					return false;
				} finally {
					acting.current = false;
					if (live.current) setPending(void 0);
				}
			};
			const open = (id) => act(`session:${id}`, () => openSession(id), "", false);
			const control = (action) => act(`control:${action}`, () => request("control", { action }, life.current?.signal), action === "recover" ? "已请求重试未决思考。" : "运行状态已同步。");
			const decide = (memory, action) => act(`memory:${memory.id}`, () => request("memory", {
				id: memory.id,
				action
			}, life.current?.signal), "记忆已更新。");
			const exportData = () => act("export", async () => {
				const value = await request("export", void 0, life.current?.signal);
				const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
				const link = document.createElement("a");
				link.href = url;
				link.download = "精神记录.json";
				document.body.append(link);
				link.click();
				link.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1e3);
			}, "已准备记录文件。", false);
			const changeTab = (event) => {
				const index = tabs.findIndex((item) => item.id === tab);
				const next = {
					ArrowRight: (index + 1) % tabs.length,
					ArrowLeft: (index + tabs.length - 1) % tabs.length,
					Home: 0,
					End: tabs.length - 1
				}[event.key];
				if (next === void 0) return;
				event.preventDefault();
				setTab(tabs[next].id);
				event.currentTarget.querySelectorAll("[role=\"tab\"]")[next]?.focus();
			};
			const task = state?.tasks.find((item) => item.id === selected) ?? state?.tasks[0];
			const taskStatus = (item) => item.ended?.outcome ?? item.assignments.at(-1)?.report?.state ?? item.assignments.at(-1)?.state ?? "pending";
			const permission = state?.permissions, chosenPermission = permissionDraft ?? permission?.mode;
			const permissionChanged = !!permission && chosenPermission !== permission.mode;
			const busy = !!pending;
			const healthErrors = Object.entries(state?.health ?? {}).filter(([, value]) => value?.state === "error");
			const decisions = state?.intentions?.filter((item) => item.question) ?? [];
			const count = state ? {
				sessions: state.sessions?.length,
				tasks: state.tasks.length,
				memory: state.memories.filter((item) => ["accepted", "active"].includes(item.state)).length,
				changes: state.changes?.length
			} : {};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "spirit",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: style_default }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "spirit-content",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "spirit-header",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "精神" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "spirit-muted",
								children: "会话、正在做的事，以及留下的经验。"
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: !state || busy,
									onClick: () => void exportData(),
									children: "导出记录"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									className: "spirit-primary",
									disabled: !state || busy,
									onClick: () => state && void open(state.mainId),
									children: ["与精神对话 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionArrow, {})]
								})]
							})]
						}),
						readError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							role: "alert",
							className: "spirit-error",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: state ? "最新状态读取失败" : "暂时无法读取精神" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: readError }),
								state && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "下方保留上次读取的记录，运行和权限状态可能已变化。" })
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: reloading || busy,
								onClick: () => void retry(),
								children: reloading ? "正在重试…" : "重试"
							})]
						}),
						actionError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							role: "alert",
							className: "spirit-error",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: actionError }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => setActionError(""),
								children: "关闭提示"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "spirit-live",
							role: "status",
							"aria-live": "polite",
							children: pending ? "正在处理…" : notice
						}),
						!state ? !readError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "spirit-empty",
							role: "status",
							children: "正在读取精神的状态与记录…"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-overview",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "spirit-card spirit-runtime",
									"aria-labelledby": `${panelId}-runtime`,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
											id: `${panelId}-runtime`,
											children: "运行状态"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "spirit-runtime-title",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "spirit-dot",
												"data-state": state.autonomy?.state ?? "unknown",
												"aria-hidden": "true"
											}), state.autonomy ? {
												running: state.busy ? "正在推进" : "已就绪",
												paused: "已暂停",
												stopped: "已停止"
											}[state.autonomy.state] : "尚未同步运行状态"]
										}),
										state.autonomy?.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "spirit-prose",
											children: state.autonomy.reason
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "spirit-muted",
											children: state.busy ? `${state.busy} 个执行会话正在运行。` : "当前没有运行中的执行会话。"
										}),
										!!decisions.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "spirit-attention-text",
											children: [
												"有 ",
												decisions.length,
												" 项主动意图等待你的回应。"
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "spirit-actions",
											children: [state.autonomy?.state === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy,
												onClick: () => void control("pause"),
												children: "暂停活动"
											}) : state.autonomy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy,
												onClick: () => void control("resume"),
												children: "恢复活动"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "spirit-danger",
												disabled: busy || !state.autonomy || state.autonomy.state === "stopped",
												onClick: () => void control("stop"),
												children: "停止所有活动"
											})]
										}),
										state.autonomy?.recoverable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "spirit-recovery",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "有尚未形成判断或需要重试的思考机会。重试会重新提交这些机会，让精神继续判断。" }),
												state.autonomy.state !== "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "spirit-muted",
													children: "先恢复活动，再重试未决思考。"
												}),
												permission?.status !== "applied" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "spirit-muted",
													children: "权限生效后可以重试。"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "spirit-actions",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														onClick: () => setTab("activity"),
														children: "查看活动"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy || state.autonomy.state !== "running" || permission?.status !== "applied",
														onClick: () => void control("recover"),
														children: "重试未决思考"
													})]
												})
											]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "spirit-card spirit-permissions",
									"aria-labelledby": `${panelId}-permission`,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
											id: `${panelId}-permission`,
											children: "访问权限"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "spirit-permission-status",
											role: permission?.status === "error" ? "alert" : void 0,
											children: permission ? `${permissionLabels[permission.mode]} · ${{
												applied: "已生效",
												pending: "正在应用",
												error: "应用未完成"
											}[permission.status]}` : "当前权限尚未同步"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
											onSubmit: (event) => {
												event.preventDefault();
												if (!chosenPermission || !permission || busy) return;
												act("permissions", () => request("permissions", { mode: chosenPermission }, life.current?.signal), "权限状态已同步。").then((ok) => {
													if (ok && live.current) setPermissionDraft(void 0);
												});
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
													disabled: !permission || busy,
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", {
															className: "spirit-sr-only",
															children: "选择精神的访问权限"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
															className: "spirit-permission-option",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																type: "radio",
																name: `${panelId}-mode`,
																value: "ask",
																checked: chosenPermission === "ask",
																onChange: () => setPermissionDraft("ask")
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "敏感操作询问" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "敏感操作由 Harness 请求确认。" })] })]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
															className: "spirit-permission-option",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																type: "radio",
																name: `${panelId}-mode`,
																value: "full",
																checked: chosenPermission === "full",
																onChange: () => setPermissionDraft("full")
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "完全访问" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "在管理的会话中直接使用宿主提供的工具。" })] })]
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "spirit-muted spirit-scope",
													children: permission?.scope || "作用于精神管理的 Harness 会话；可用能力仍由宿主和系统决定。"
												}),
												permission?.detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "spirit-prose spirit-muted",
													children: permission.detail
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "spirit-actions",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "submit",
														disabled: busy || !permission || permission.status === "pending" || !permissionChanged && permission.status === "applied",
														children: pending === "permissions" ? "正在应用…" : "应用权限"
													}), permissionChanged && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "尚未应用所选权限" })]
												})
											]
										})
									]
								})]
							}),
							!!healthErrors.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								role: "alert",
								className: "spirit-error",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "有运行问题需要查看" }), healthErrors.map(([name, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									name,
									"：",
									value.detail
								] }, name))] })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "spirit-tabs",
								role: "tablist",
								"aria-label": "精神记录",
								onKeyDown: changeTab,
								children: tabs.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									role: "tab",
									id: `${panelId}-tab-${item.id}`,
									"aria-controls": `${panelId}-panel-${item.id}`,
									"aria-selected": tab === item.id,
									tabIndex: tab === item.id ? 0 : -1,
									onClick: () => setTab(item.id),
									children: [item.label, count[item.id] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: count[item.id] })]
								}, item.id))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-tabpanel",
								role: "tabpanel",
								id: `${panelId}-panel-${tab}`,
								"aria-labelledby": `${panelId}-tab-${tab}`,
								tabIndex: 0,
								children: [
									tab === "activity" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "spirit-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "主动意图" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "spirit-muted",
												children: "查看精神想推进什么、为什么，以及哪些事正在等你决定。"
											}),
											!state.intentions?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "spirit-empty-inline",
												children: state.intentions ? "目前没有记录中的主动意图。" : "主动意图尚未同步。"
											}),
											state.intentions?.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
												className: "spirit-record",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-record-heading",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: item.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "spirit-tag",
															children: labels[item.state] ?? item.state
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "spirit-prose",
														children: item.reason || "尚未记录行动理由。"
													}),
													item.question && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-attention",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "等待你的决定" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "spirit-prose",
															children: item.question
														})]
													}),
													(item.sessionId || item.question) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
														disabled: busy,
														onClick: () => void open(item.sessionId ?? state.mainId),
														children: ["进入相关会话 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionArrow, {})]
													})
												]
											}, item.id))
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "spirit-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "最近活动" }),
											!state.activity?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "spirit-empty-inline",
												children: state.activity ? "尚无活动记录。可以从与精神对话开始。" : "活动记录尚未同步。"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
												className: "spirit-timeline",
												children: state.activity?.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "spirit-prose",
														children: item.summary
													}),
													item.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "spirit-muted spirit-prose",
														children: ["缘由：", item.reason]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-record-meta",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
															dateTime: item.at,
															children: dateLabel(item.at)
														}), item.sessionId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "spirit-link",
															disabled: busy,
															onClick: () => void open(item.sessionId),
															children: "查看会话"
														})]
													})
												] }, item.id))
											})
										]
									})] }),
									tab === "sessions" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "spirit-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "会话" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "spirit-muted",
												children: "在原生会话中查看消息、工具执行和待确认操作。"
											}),
											!state.sessions?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "spirit-empty-inline",
												children: state.sessions ? "当前没有已登记的会话。" : "会话列表尚未同步。"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "spirit-session-list",
												children: state.sessions?.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
													className: "spirit-record",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "spirit-record-heading",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: item.title || "未命名会话" }), item.status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "spirit-tag",
																children: labels[item.status] ?? item.status
															})]
														}),
														item.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "spirit-prose",
															children: item.reason
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
															className: "spirit-meta",
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "模型" }),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: item.model || "尚未选定" }),
																item.effort && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "推理强度" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: item.effort })] })
															]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
															disabled: busy,
															onClick: () => void open(item.id),
															children: ["打开会话 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionArrow, {})]
														})
													]
												}, item.id))
											})
										]
									}),
									tab === "tasks" && (!task ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "spirit-empty",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "还没有记录中的事情" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "与精神对话后，持续推进的事情会在这里留下进展和相关会话。" })]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "spirit-columns",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
											"aria-label": "事情列表",
											children: state.tasks.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												"aria-pressed": task.id === item.id,
												onClick: () => setSelected(item.id),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: labels[taskStatus(item)] ?? taskStatus(item) })]
											}, item.id))
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "spirit-task",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "spirit-record-heading",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "spirit-tag",
														children: labels[taskStatus(task)] ?? taskStatus(task)
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: task.title })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-actions",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
															disabled: busy,
															onClick: () => void open(task.sessionId),
															children: ["查看执行会话 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionArrow, {})]
														}), !task.ended && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															disabled: busy,
															className: "spirit-danger",
															onClick: () => void act(`stop:${task.id}`, () => request("stop", { id: task.id }, life.current?.signal), "这件事的状态已同步。"),
															children: "停止这件事"
														})]
													})]
												}),
												task.attention && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
													className: "spirit-attention",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "等待你的决定" }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "spirit-prose",
															children: task.attention.question
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															disabled: busy,
															onClick: () => void open(state.mainId),
															children: "回到对话"
														})
													]
												}),
												task.assignments.at(-1)?.report && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
													className: "spirit-section",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "最近进展" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "spirit-prose",
														children: task.assignments.at(-1).report.summary
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
													className: "spirit-section",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "这件事的来由" }),
														task.experience?.source && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "spirit-muted",
															children: task.experience.source.kind === "self" ? "精神主动发起" : "来自本人请求"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "spirit-prose",
															children: task.mandate?.scope || "尚未记录。"
														}),
														task.experience?.source?.kind === "self" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
															className: "spirit-prose",
															children: ["发起原因：", task.experience.source.reason]
														})
													]
												}),
												task.experience?.result && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
													className: "spirit-section",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "留下的成果" }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "spirit-prose",
															children: task.experience.result.text
														}),
														task.experience.result.limits && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
															className: "spirit-muted spirit-prose",
															children: ["尚有限制：", task.experience.result.limits]
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(History, { experience: task.experience })
											]
										})]
									})),
									tab === "memory" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "spirit-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "留下的记忆" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "spirit-muted",
												children: "保留的记忆会参与后续会话，并可随经验修订。遗忘会清空这条记忆的内容与来源引用，不再作为长期记忆提供；原会话与事情记录保留。"
											}),
											!state.memories.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "spirit-empty-inline",
												children: "目前没有长期记忆。"
											}),
											state.memories.map((memory) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
												className: "spirit-record",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-record-meta",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: memoryStates[memory.state] ?? memory.state }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: memoryKinds[memory.kind] ?? memory.kind })]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "spirit-memory-text spirit-prose",
														children: memory.statement
													}),
													memory.provenance?.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "spirit-muted spirit-prose",
														children: ["保留原因：", memory.provenance.reason]
													}),
													memory.limits && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "spirit-muted spirit-prose",
														children: ["适用限度：", memory.limits]
													}),
													memory.provenance?.reference && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "spirit-muted spirit-prose",
														children: ["来源记录：", memory.provenance.reference]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-actions",
														children: [
															memory.ticketId && state.tasks.some((item) => item.id === memory.ticketId) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																onClick: () => {
																	setSelected(memory.ticketId);
																	setTab("tasks");
																},
																children: "查看来源"
															}),
															memory.provenance?.sessionId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																disabled: busy,
																onClick: () => void open(memory.provenance.sessionId),
																children: "查看来源会话"
															}),
															["proposed", "active"].includes(memory.state) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																disabled: busy,
																onClick: () => void decide(memory, "reject"),
																children: "不接纳"
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																disabled: busy,
																onClick: () => void decide(memory, "accept"),
																children: "接纳"
															})] }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																disabled: busy,
																onClick: () => void decide(memory, "forget"),
																children: "遗忘此条"
															})
														]
													})
												]
											}, memory.id))
										]
									}),
									tab === "changes" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "spirit-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "自身改动" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "spirit-muted",
												children: "查看对自身或宿主所作改动的理由、结果与相关会话。"
											}),
											!state.changes?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "spirit-empty-inline",
												children: state.changes ? "尚无自身改动记录。" : "自身改动记录尚未同步。"
											}),
											state.changes?.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
												className: "spirit-record",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-record-heading",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: item.summary }), item.status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "spirit-tag",
															children: changeStates[item.status] ?? labels[item.status] ?? item.status
														})]
													}),
													item.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "spirit-prose",
														children: ["改动原因：", item.reason]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Activation, {
														change: item,
														receipts: state.activation?.receipts
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "spirit-record-meta",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
															dateTime: item.at,
															children: dateLabel(item.at)
														}), item.sessionId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "spirit-link",
															disabled: busy,
															onClick: () => void open(item.sessionId),
															children: "查看相关会话"
														})]
													})
												]
											}, item.id))
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
								className: "spirit-footer",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: updatedAt ? `最近读取：${dateLabel(updatedAt)}` : "" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: reloading || busy,
									onClick: () => void retry(),
									children: reloading ? "正在刷新…" : "刷新状态"
								})]
							})
						] })
					]
				})]
			});
		}
		const inject = [
			"slots",
			"locale",
			"sessions",
			"uiWorkspace"
		];
		function apply(ctx) {
			const panelId = "dsh-spirit";
			ctx.effect(() => ctx.locale.register("personalSpirit", {
				zh: { panel: "精神" },
				en: { panel: "精神" }
			}));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: panelId,
				locale: "personalSpirit",
				inject: () => ({})
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Panel, { openSession: async (id) => {
				const target = id;
				if (ctx.sessions.list.getSnapshot().phase !== "ready" || !ctx.sessions.list.getSnapshot().byId[target]) await ctx.sessions.refresh();
				const list = ctx.sessions.list.getSnapshot();
				if (list.phase !== "ready") throw new Error("会话列表尚未就绪，请稍后重试。");
				if (!list.byId[target]) throw new Error("未在 Harness 中找到这个会话，请刷新后重试。");
				ctx.uiWorkspace.openSession(target);
			} })));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: panelId,
				order: 9,
				locale: "personalSpirit",
				label: () => "精神"
			}, ({ size }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.6",
				strokeLinecap: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3a9 9 0 1 0 9 9M12 3v6a3 3 0 1 0 3 3h6M12 9l6-6M18 3h3v3" })
			})));
		}
		exports.Panel = Panel;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
