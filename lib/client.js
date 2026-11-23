window.__ModuleLoader__.load({
	id: "dsh-jingshen",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/native-interactions.css?raw
		var native_interactions_default = ".jingshen-native-interaction {\n  color: inherit;\n  background: color-mix(in srgb, #d78320 9%, transparent);\n  border: 1px solid color-mix(in srgb, #d78320 28%, transparent);\n  border-radius: 14px;\n  display: grid;\n  gap: 9px;\n  padding: 12px 14px;\n  text-align: start;\n}\n\n.jingshen-native-interaction p {\n  margin: 0;\n  font-size: .88rem;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n\n.jingshen-native-interaction code { font-size: .78rem; overflow-wrap: anywhere; }\n.jingshen-native-interaction fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }\n.jingshen-native-interaction legend { font-weight: 600; margin-bottom: 4px; }\n.jingshen-native-interaction label { display: block; font-size: .85rem; margin: 5px 0; }\n.jingshen-native-interaction label small { display: block; margin-inline-start: 21px; }\n.jingshen-native-interaction input[type=\"text\"] {\n  color: inherit;\n  background: transparent;\n  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);\n  border-radius: 8px;\n  display: block;\n  margin-top: 3px;\n  padding: 5px 7px;\n  width: 100%;\n}\n\n.jingshen-native-actions { display: flex; flex-wrap: wrap; gap: 7px; justify-content: end; }\n.jingshen-native-actions button {\n  color: inherit;\n  background: transparent;\n  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);\n  border-radius: 9px;\n  cursor: pointer;\n  font: inherit;\n  font-size: .83rem;\n  padding: 5px 10px;\n}\n.jingshen-native-actions button:last-child { background: #326cb1; border-color: transparent; color: white; }\n.jingshen-native-actions button:disabled { cursor: default; opacity: .55; }\n";
		// src/native-interactions.tsx
		function isApproval(value) {
			return value?.kind === "approval" && typeof value.answer === "function";
		}
		function isQuestion(value) {
			return (value?.kind === "question" || value?.kind === "plan-review") && typeof value.answer === "function";
		}
		const emptyUnsubscribe = () => () => {};
		const errorText = (reason) => reason instanceof Error ? reason.message : String(reason);
		function useNativeAnswer() {
			const active = (0, react.useRef)(false);
			const [pending, setPending] = (0, react.useState)(false), [error, setError] = (0, react.useState)("");
			return {
				pending,
				error,
				run: async (action) => {
					if (active.current) return;
					active.current = true;
					setPending(true);
					setError("");
					try {
						await action();
					} catch (reason) {
						setError(errorText(reason));
						active.current = false;
						setPending(false);
					}
				}
			};
		}
		function NativeApproval({ approval }) {
			const { pending, error, run } = useNativeAnswer();
			const reason = approval.displayReason?.["zh-CN"] ?? approval.displayReason?.zh ?? approval.reason ?? approval.displayReason?.en;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "jingshen-native-interaction",
				"data-native-interaction": "approval",
				"aria-label": "敏感操作审批",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "敏感操作审批" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: approval.toolName }),
					reason && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: reason }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "jingshen-native-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: pending || !approval.answerable,
							onClick: () => void run(async () => {
								if (approval.answerable) await approval.answer("rejected");
							}),
							children: "拒绝"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: pending || !approval.answerable,
							onClick: () => void run(async () => {
								if (approval.answerable) await approval.answer("allowed-once");
							}),
							children: "允许一次"
						})]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					})
				]
			});
		}
		function NativeQuestion({ card }) {
			const state = (0, react.useSyncExternalStore)(card.subscribe, card.getSnapshot, card.getSnapshot);
			const { pending, error, run } = useNativeAnswer();
			const [selections, setSelections] = (0, react.useState)({});
			const [text, setText] = (0, react.useState)({});
			const answers = card.questions.map(({ id }) => ({
				id,
				selected: selections[id] ?? [],
				...text[id]?.trim() ? { custom: text[id].trim() } : {}
			}));
			const enabled = !state.closed && state.channel !== "none" && !pending && answers.every((item) => item.selected.length || item.custom);
			const answer = (event) => {
				event.preventDefault();
				if (enabled) run(() => card.answer({ answers }));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: "jingshen-native-interaction",
				"data-native-interaction": "question",
				"aria-label": "精神正在询问",
				onSubmit: answer,
				onFocus: () => card.holdFocus(),
				onBlur: (event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) card.releaseFocus();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: card.kind === "plan-review" ? "请核对方案" : "精神正在询问" }),
					card.questions.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
						disabled: pending || state.closed,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("legend", { children: [item.header ? `${item.header} · ` : "", item.question] }),
							item.detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: item.detail }),
							item.options?.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: item.multiSelect ? "checkbox" : "radio",
									name: item.id,
									checked: selections[item.id]?.includes(option.label) ?? false,
									onChange: (event) => {
										card.engage();
										const checked = event.target.checked;
										setSelections((previous) => ({
											...previous,
											[item.id]: item.multiSelect ? checked ? [...previous[item.id] ?? [], option.label] : (previous[item.id] ?? []).filter((label) => label !== option.label) : [option.label]
										}));
										if (!item.multiSelect) setText((previous) => ({
											...previous,
											[item.id]: ""
										}));
									}
								}),
								option.label,
								option.description && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: option.description })
							] }, option.label)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [item.options?.length ? "其他回答" : "回答", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								maxLength: 8e3,
								value: text[item.id] ?? "",
								onChange: (event) => {
									card.engage();
									setText((previous) => ({
										...previous,
										[item.id]: event.target.value
									}));
									if (!item.multiSelect) setSelections((previous) => ({
										...previous,
										[item.id]: []
									}));
								}
							})] })
						]
					}, item.id)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "jingshen-native-actions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: !enabled,
							children: "发送回答"
						})
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					})
				]
			});
		}
		function NativeInteractions({ ctx, sessionId, onPendingChange }) {
			const root = ctx;
			const status = root.uiSession?.sessionStatus;
			const subscribe = (0, react.useCallback)((listener) => status?.subscribe(listener) ?? emptyUnsubscribe(), [status]);
			const read = (0, react.useCallback)(() => status?.getSnapshot().get(sessionId)?.pendingInteraction, [status, sessionId]);
			const value = (0, react.useSyncExternalStore)(subscribe, read, read);
			(0, react.useEffect)(() => {
				if (!status) return;
				const controller = new AbortController();
				let reference;
				let retaining = false;
				const retain = () => {
					if (controller.signal.aborted || retaining || reference || !root.sessions.list.getSnapshot().byId[sessionId]) return;
					retaining = true;
					try {
						const current = root.sessions.retain(sessionId, {
							signal: controller.signal,
							source: "personalSpiritInteractions"
						});
						reference = current;
						current.ready.catch(() => {
							current.release();
							if (reference === current) reference = void 0;
						});
					} catch {} finally {
						retaining = false;
					}
				};
				const unsubscribe = root.sessions.list.subscribe(retain);
				retain();
				if (!reference) root.sessions.refresh().then(retain).catch(() => {});
				return () => {
					controller.abort();
					unsubscribe();
					reference?.release();
				};
			}, [
				root,
				status,
				sessionId
			]);
			const approval = value?.sessionId === sessionId && isApproval(value) ? value : void 0;
			const question = value?.sessionId === sessionId && isQuestion(value) ? value : void 0;
			const count = approval || question ? 1 : 0;
			(0, react.useEffect)(() => {
				onPendingChange?.(count);
			}, [count, onPendingChange]);
			(0, react.useEffect)(() => () => onPendingChange?.(0), [onPendingChange]);
			if (approval) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: native_interactions_default }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeApproval, { approval }, approval.key)] });
			if (question) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: native_interactions_default }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeQuestion, { card: question }, question.key)] });
			return null;
		}
		// src/fish.tsx
		const fishCss = ".spirit-fish {\n  display: inline-grid;\n  place-items: center;\n  position: relative;\n  inline-size: 100%;\n  block-size: 100%;\n  aspect-ratio: 1;\n  container-type: size;\n  vertical-align: middle;\n  pointer-events: none;\n  isolation: isolate;\n  user-select: none;\n}\n.spirit-fish-stage {\n  position: relative;\n  inline-size: 100%;\n  block-size: 100%;\n  inline-size: min(100cqw, 100cqh);\n  block-size: min(100cqw, 100cqh);\n}\n.spirit-fish-framing, .spirit-fish-rhythm, .spirit-fish-attitude, .spirit-fish-original, .spirit-fish-art,\n.spirit-fish-part, .spirit-fish-alt, .spirit-fish-accent {\n  position: absolute;\n  inset: 0;\n}\n.spirit-fish-art, .spirit-fish-part, .spirit-fish-alt {\n  background: center / contain no-repeat;\n  filter: drop-shadow(0 2px 2px #17233b25);\n}\n.spirit-fish-part {\n  filter: none;\n}\n.spirit-fish-framing { translate: var(--fish-center); }\n.spirit-fish[data-variant='portrait'] { overflow: hidden; }\n.spirit-fish[data-variant='portrait'] .spirit-fish-framing {\n  translate: calc(50% - var(--fish-x)) calc(50% - var(--fish-y));\n  transform: scale(1.75);\n  transform-origin: var(--fish-x) var(--fish-y);\n}\n.spirit-fish-rhythm {\n  --fish-float-duration: 4.6s;\n  --fish-lift: -1.8%;\n  --fish-rock: -1.2deg;\n  transform-origin: 50% 70%;\n  animation: spirit-fish-float var(--fish-float-duration) ease-in-out infinite;\n}\n.spirit-fish[data-scene='observing'] .spirit-fish-rhythm {\n  --fish-float-duration: 5.4s;\n  --fish-lift: -1.1%;\n  --fish-rock: 2deg;\n}\n.spirit-fish[data-scene='working'] .spirit-fish-rhythm {\n  --fish-float-duration: 3.5s;\n  --fish-lift: -.7%;\n  --fish-rock: .65deg;\n}\n.spirit-fish[data-scene='video'] .spirit-fish-rhythm {\n  --fish-float-duration: 4.1s;\n  --fish-lift: -1.2%;\n  --fish-rock: -1.55deg;\n}\n.spirit-fish[data-scene='sleep'] .spirit-fish-rhythm {\n  --fish-float-duration: 6.5s;\n  --fish-lift: -.48%;\n  --fish-rock: -.25deg;\n}\n@keyframes spirit-fish-float {\n  0%, 100% { transform: translateY(0) rotate(0) scaleY(1); }\n  48% { transform: translateY(var(--fish-lift)) rotate(var(--fish-rock)) scaleY(1.011); }\n}\n.spirit-fish-part {\n  mask-image: radial-gradient(ellipse 14% 21% at var(--fish-x) var(--fish-y), #000 30%, transparent 78%);\n  transform-origin: var(--fish-x) var(--fish-y);\n  opacity: .76;\n  animation: spirit-fish-flow 4.6s ease-in-out infinite;\n}\n.spirit-fish-tail {\n  --fish-part-turn: -5deg;\n  --fish-part-shift: -1.1%;\n  mask-image: radial-gradient(ellipse 17% 14% at var(--fish-x) var(--fish-y), #000 30%, transparent 78%);\n  animation-delay: -.35s;\n}\n.spirit-fish-hair {\n  --fish-part-turn: 3.2deg;\n  --fish-part-shift: .65%;\n  animation-delay: -.75s;\n}\n.spirit-fish[data-scene='sleep'] .spirit-fish-part { animation-duration: 6.5s; }\n@keyframes spirit-fish-flow {\n  0%, 100% { transform: none; }\n  54% { transform: translateX(var(--fish-part-shift)) rotate(var(--fish-part-turn)); }\n}\n.spirit-fish-alt { opacity: 0; }\n.spirit-fish[data-cadence] .spirit-fish-original,\n.spirit-fish[data-cadence] .spirit-fish-alt {\n  animation: var(--fish-change, spirit-fish-keystrokes) var(--fish-frame-duration, 1.15s) steps(1, end) infinite;\n}\n.spirit-fish-original { --fish-primary: 1; --fish-secondary: 0; }\n.spirit-fish-alt { --fish-primary: 0; --fish-secondary: 1; }\n.spirit-fish[data-cadence='scrolling'] { --fish-change: spirit-fish-scroll; --fish-frame-duration: 2.65s; }\n.spirit-fish[data-cadence='blink'] { --fish-change: spirit-fish-blink; --fish-frame-duration: 7.65s; }\n.spirit-fish[data-cadence='speech'] { --fish-change: spirit-fish-syllables; --fish-frame-duration: .82s; }\n.spirit-fish[data-cadence='speech'] .spirit-fish-original { animation: none; }\n.spirit-fish[data-cadence='speech'] .spirit-fish-alt {\n  filter: none;\n  mask-image: radial-gradient(ellipse 5.6% 3.3% at var(--fish-x) var(--fish-y), #000 61%, transparent 99%);\n}\n@keyframes spirit-fish-keystrokes {\n  0%, 29%, 66%, 94%, 100% { opacity: var(--fish-primary); }\n  17%, 52%, 83% { opacity: var(--fish-secondary); }\n}\n@keyframes spirit-fish-scroll {\n  0%, 34%, 100% { opacity: var(--fish-primary); }\n  18%, 76% { opacity: var(--fish-secondary); }\n}\n@keyframes spirit-fish-blink {\n  0%, 31.5%, 68%, 100% { opacity: var(--fish-primary); }\n  30%, 66.3% { opacity: var(--fish-secondary); }\n}\n@keyframes spirit-fish-syllables {\n  0%, 34%, 68%, 97%, 100% { opacity: var(--fish-primary); }\n  9%, 46%, 80% { opacity: var(--fish-secondary); }\n}\n.spirit-fish-mouth {\n  position: absolute;\n  inline-size: 5%;\n  block-size: 2.9%;\n  inset-inline-start: var(--fish-x);\n  inset-block-start: var(--fish-y);\n  background: linear-gradient(#533451 63%, #bc748d 64%);\n  border-radius: 35% 35% 52% 52% / 52% 52% 60% 60%;\n  transform: translate(-50%, -42%) scaleY(.65);\n  animation: spirit-fish-speech .47s ease-in-out infinite;\n}\n@keyframes spirit-fish-speech {\n  0%, 100% { transform: translate(-50%, -42%) scale(.9, .25); }\n  23% { transform: translate(-50%, -42%) scale(1, 1); }\n  51% { transform: translate(-50%, -42%) scale(.85, .43); }\n  78% { transform: translate(-50%, -42%) scale(.65, .96); }\n}\n.spirit-fish-earwave {\n  position: absolute;\n  inset-inline-start: var(--fish-x);\n  inset-block-start: var(--fish-y);\n  inline-size: 8%;\n  block-size: 8%;\n  color: #6676b7;\n}\n.spirit-fish-earwave > i {\n  position: absolute;\n  inline-size: 65%;\n  block-size: 88%;\n  border-inline-end: max(1px, .32cqmin) solid currentColor;\n  border-radius: 50%;\n  opacity: .7;\n}\n.spirit-fish-earwave > i + i { scale: 1.48; opacity: .4; }\n.spirit-fish[data-speaking] .spirit-fish-earwave > i { animation: spirit-fish-wave .91s ease-in-out infinite alternate; }\n.spirit-fish[data-speaking] .spirit-fish-earwave > i + i { animation-delay: -.28s; }\n@keyframes spirit-fish-wave {\n  from { opacity: .28; transform: translateX(-12%); }\n  to { opacity: .78; transform: translateX(14%); }\n}\n.spirit-fish[data-mood='smile'] .spirit-fish-attitude { animation: spirit-fish-lighten .72s ease-out; }\n.spirit-fish[data-mood='warm'] .spirit-fish-attitude { animation: spirit-fish-lighten 1.14s ease-out; }\n.spirit-fish[data-mood='sad'] .spirit-fish-attitude { animation: spirit-fish-lower 1.05s ease-out; }\n.spirit-fish[data-mood='tired'] .spirit-fish-attitude { animation: spirit-fish-lower 1.5s ease-out; }\n.spirit-fish[data-mood='surprise'] .spirit-fish-attitude { animation: spirit-fish-startle .62s ease-out; }\n.spirit-fish[data-mood='curious'] .spirit-fish-attitude { animation: spirit-fish-tilt 1.12s ease-in-out; }\n@keyframes spirit-fish-lighten {\n  35% { transform: translateY(-3.8%) rotate(-2deg) scale(.98,1.026); }\n  66% { transform: translateY(.8%) scale(1.012,.985); }\n}\n@keyframes spirit-fish-lower {\n  45% { transform: translateY(2.3%) scale(1.015,.973) rotate(2.5deg); }\n}\n@keyframes spirit-fish-startle {\n  21% { transform: translateY(-5.4%) scale(.965,1.04); }\n  56% { transform: translateY(1.6%) scale(1.02,.975); }\n}\n@keyframes spirit-fish-tilt {\n  42% { transform: translateX(1.1%) rotate(4deg); }\n}\n.spirit-fish-accent { display: none; }\n.spirit-fish[data-mood='smile'] .spirit-fish-accent, .spirit-fish[data-mood='warm'] .spirit-fish-accent,\n.spirit-fish[data-mood='surprise'] .spirit-fish-accent { display: block; }\n.spirit-fish[data-variant='portrait'] .spirit-fish-accent { display: none; }\n.spirit-fish-accent > i {\n  position: absolute;\n  inset-inline-start: calc(var(--fish-x) + 29%);\n  inset-block-start: calc(var(--fish-y) - 14%);\n  inline-size: 5%;\n  block-size: 5%;\n  background: #7d91d9;\n  opacity: 0;\n  clip-path: polygon(50% 0, 63% 35%, 100% 50%, 63% 65%, 50% 100%, 37% 65%, 0 50%, 37% 35%);\n  animation: spirit-fish-glint .97s ease-out;\n}\n.spirit-fish-accent > i + i {\n  inset-inline-start: calc(var(--fish-x) - 33%);\n  inset-block-start: calc(var(--fish-y) - 6%);\n  inline-size: 3.7%;\n  block-size: 3.7%;\n  animation-delay: .1s;\n}\n.spirit-fish[data-mood='warm'] .spirit-fish-accent > i { background: #b65fb5; }\n.spirit-fish[data-mood='surprise'] .spirit-fish-accent > i { background: #546bc5; animation-duration: .66s; }\n@keyframes spirit-fish-glint {\n  14% { opacity: .95; transform: scale(.65); }\n  47% { opacity: .8; transform: translateY(-24%) scale(1.06); }\n  100% { opacity: 0; transform: translateY(-53%) scale(.72); }\n}\n@media (prefers-reduced-motion: reduce) {\n  .spirit-fish *, .spirit-fish *::before, .spirit-fish *::after {\n    animation: none !important;\n    transition: none !important;\n  }\n  .spirit-fish-part, .spirit-fish-alt { display: none; }\n}\n";
		const fishAssets = "/personal-spirit/assets/fish/";
		const active = {
			working: {
				sheet: "activity",
				frame: 0,
				center: [-6.25, 1.85],
				mouth: [50.8, 50.6],
				portrait: [50.8, 45],
				hair: [80, 62],
				tail: [89, 70],
				alternate: {
					frame: 1,
					align: [5.7, 0],
					cadence: "typing"
				}
			},
			video: {
				sheet: "activity",
				frame: 2,
				center: [-.4, 1.7],
				mouth: [44.7, 51],
				portrait: [44.8, 46.2],
				hair: [75, 64],
				tail: [83, 70],
				alternate: {
					frame: 3,
					align: [-3.5, -.2],
					cadence: "scrolling"
				}
			},
			observing: {
				sheet: "activity",
				frame: 5,
				center: [2.7, .6],
				mouth: [38.4, 43],
				portrait: [38.2, 38],
				hair: [66, 57],
				tail: [78, 69]
			},
			sleep: {
				sheet: "activity",
				frame: 4,
				center: [5.3, -6.3],
				mouth: [46, 64],
				portrait: [48, 60],
				hair: [24, 70],
				tail: [80, 72]
			}
		};
		const neutral = {
			sheet: "social",
			frame: 0,
			center: [-7, .7],
			mouth: [54, 44],
			portrait: [54, 38],
			hair: [77, 59],
			tail: [87, 70],
			ear: [84, 37],
			alternate: {
				sheet: "social-rest",
				frame: 0,
				align: [0, 0],
				cadence: "blink"
			}
		};
		const conversing = {
			sheet: "social-rest",
			frame: 1,
			center: [-2.8, .8],
			mouth: [46, 43.2],
			portrait: [46, 37],
			hair: [74, 59],
			tail: [80, 70],
			ear: [78, 37]
		};
		const social = {
			smile: {
				...conversing,
				frame: 2,
				center: [0, .7],
				mouth: [47.1, 42.6],
				portrait: [47, 36],
				ear: [76, 34]
			},
			sad: {
				...conversing,
				frame: 3,
				center: [-8.4, 1.1],
				mouth: [54.7, 44.5],
				portrait: [54, 40],
				ear: [83, 34],
				tail: [87, 71]
			},
			surprise: {
				...conversing,
				frame: 4,
				center: [-1.9, 1.1],
				mouth: [49.8, 41.4],
				portrait: [50, 36],
				ear: [79, 35]
			},
			warm: {
				...conversing,
				frame: 5,
				center: [-2.1, 1.1],
				mouth: [45.7, 44.1],
				portrait: [46, 39],
				ear: [76, 34]
			}
		};
		function spriteStyle({ sheet, frame }) {
			return {
				backgroundImage: `url("${fishAssets}${sheet}.png")`,
				backgroundSize: "300% 200%",
				backgroundPosition: `${50 * (frame % 3)}% ${100 * Math.floor(frame / 3)}%`
			};
		}
		function anchor([left, top]) {
			return {
				"--fish-x": `${left}%`,
				"--fish-y": `${top}%`
			};
		}
		/** Visual states only reflect inputs supplied by the host. Mood is optional and cannot replace a task pose. */
		function SpiritFish({ activity, speaking = false, onCall = false, mood, variant, className, style }) {
			const scene = activity === "working" || activity === "video" ? activity : onCall ? "call" : activity === "sleep" && speaking ? "idle" : activity;
			const expression = scene === "sleep" ? void 0 : mood ?? void 0;
			const socialPose = expression && social[expression];
			const conversational = scene === "idle" || scene === "call";
			const pose = conversational ? socialPose || (speaking || onCall ? conversing : neutral) : active[scene];
			const alternate = conversational && speaking ? {
				sheet: "social",
				frame: pose.frame,
				align: [0, 0],
				cadence: "speech"
			} : pose.alternate;
			const artwork = spriteStyle(pose);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				className: className ? `spirit-fish ${className}` : "spirit-fish",
				style,
				"data-activity": activity,
				"data-scene": scene,
				"data-speaking": speaking || void 0,
				"data-on-call": onCall || void 0,
				"data-mood": expression,
				"data-variant": variant,
				"data-cadence": alternate?.cadence,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "spirit-fish-stage",
					style: {
						...anchor(pose.portrait),
						"--fish-center": `${pose.center[0]}% ${pose.center[1]}%`
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "spirit-fish-framing",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "spirit-fish-rhythm",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "spirit-fish-attitude",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "spirit-fish-original",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "spirit-fish-art",
												style: artwork
											}),
											pose.hair && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "spirit-fish-part spirit-fish-hair",
												style: {
													...artwork,
													...anchor(pose.hair)
												}
											}),
											pose.tail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "spirit-fish-part spirit-fish-tail",
												style: {
													...artwork,
													...anchor(pose.tail)
												}
											})
										]
									}),
									alternate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "spirit-fish-alt",
										style: {
											...spriteStyle({
												sheet: alternate.sheet ?? pose.sheet,
												frame: alternate.frame
											}),
											...anchor(pose.mouth),
											translate: `${alternate.align[0]}% ${alternate.align[1]}%`
										}
									}),
									speaking && alternate?.cadence !== "speech" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "spirit-fish-mouth",
										style: anchor(pose.mouth)
									}),
									scene === "call" && pose.ear && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "spirit-fish-earwave",
										style: anchor(pose.ear),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})]
									}),
									expression && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "spirit-fish-accent",
										style: anchor(pose.portrait),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})]
									})
								]
							}, expression ?? "plain")
						})
					})
				})
			});
		}
		// src/media-icons.tsx
		const paths = {
			phone: "M7 3H4a1 1 0 0 0-1 1v1c0 8.84 7.16 16 16 16h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-.76-.97l-4-1a1 1 0 0 0-1.03.34l-1.63 2.04a13.04 13.04 0 0 1-6.99-6.99l2.04-1.63a1 1 0 0 0 .34-1.03l-1-4A1 1 0 0 0 7 3Z",
			hangup: "M2.6 14.6a1.5 1.5 0 0 1 0-2.1 13 13 0 0 1 18.8 0 1.5 1.5 0 0 1 0 2.1l-1.8 1.8a1.2 1.2 0 0 1-1.6.1l-2.6-1.9a1.2 1.2 0 0 1-.5-1v-1.4a9 9 0 0 0-5.8 0v1.4a1.2 1.2 0 0 1-.5 1l-2.6 1.9a1.2 1.2 0 0 1-1.6-.1Z",
			camera: "M15 10l5-3v10l-5-3m-1 5H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z",
			mic: "M9 10V6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0v-1ZM5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6",
			muted: "m3 3 18 18M9 9v2a3 3 0 0 0 4.5 2.6M9.8 4a3 3 0 0 1 5.2 2v4m-10 1a7 7 0 0 0 11 5.7m2.5-3.1c.3-.8.5-1.7.5-2.6M12 18v3m-3 0h6",
			stop: "M7 7h10v10H7z"
		};
		function MediaIcon({ name }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "20",
				height: "20",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.7",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: paths[name] })
			});
		}
		// src/vision-tab.ts
		const channel = "dsh-jingshen/video-tab/v1";
		const handlePattern = /^spirit-video-[0-9a-f-]{36}$/;
		async function bindCapturedVideo(track, signal) {
			const selected = track;
			const handle = selected.getCaptureHandle?.()?.handle;
			if (!handle || !handlePattern.test(handle) || signal.aborted) return;
			const control = async (action) => {
				signal.throwIfAborted();
				if (track.readyState === "ended" || selected.getCaptureHandle?.()?.handle !== handle) throw new Error("视频标签页的共享已结束。");
				const id = crypto.randomUUID();
				return new Promise((resolve, reject) => {
					const clear = () => {
						window.clearTimeout(timer);
						window.removeEventListener("message", receive);
						signal.removeEventListener("abort", abort);
						track.removeEventListener("ended", abort);
						track.removeEventListener("capturehandlechange", changed);
					};
					const abort = () => {
						clear();
						reject(/* @__PURE__ */ new Error("视频标签页的授权已结束。"));
					};
					const changed = () => {
						if (selected.getCaptureHandle?.()?.handle !== handle) abort();
					};
					const receive = (event) => {
						if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data.kind !== "reply" || event.data.id !== id) return;
						clear();
						const result = event.data.result;
						if (selected.getCaptureHandle?.()?.handle !== handle || !result || typeof result.playing !== "boolean" || typeof result.time !== "number" || !Number.isFinite(result.time) || result.time < 0) reject(/* @__PURE__ */ new Error("视频标签页无法执行此操作，请检查标签页授权和播放器。"));
						else resolve({
							time: result.time,
							playing: result.playing
						});
					};
					const timer = window.setTimeout(() => {
						clear();
						reject(/* @__PURE__ */ new Error("视频标签页控制已超时。"));
					}, 1500);
					window.addEventListener("message", receive);
					signal.addEventListener("abort", abort, { once: true });
					track.addEventListener("ended", abort, { once: true });
					track.addEventListener("capturehandlechange", changed);
					window.postMessage({
						channel,
						kind: "command",
						id,
						action,
						handle
					}, location.origin);
				});
			};
			try {
				await control("status");
				return { control };
			} catch {
				return;
			}
		}
		// src/vision-url.ts
		const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i;
		function videoHost(input) {
			const host = input.trim().toLowerCase();
			if (host.length > 253 || !domain.test(host) || host.split(".").some((label) => label.length > 63)) throw new Error("请输入一个 HTTPS 视频域名，不含地址路径或端口。");
			return host;
		}
		function permittedVideoUrl(input, allowedHost) {
			const authority = /^https:\/\/([^/?#]+)(?:[/?]|$)/i.exec(input)?.[1];
			if (!authority || authority.toLowerCase() !== allowedHost || input.includes("#") || /[\\\s]/.test(input)) throw new Error("视频地址必须位于本人授权的 HTTPS 域名，不含登录信息、端口或片段。");
			const url = new URL(input);
			if (url.protocol !== "https:" || url.hostname !== allowedHost || url.username || url.password || url.port) throw new Error("视频地址超出本人授权的来源。");
			return url.href;
		}
		// src/vision-client.tsx
		const apiPath = "/personal-spirit/api/vision";
		const cadence = 850;
		const maxVideoBytes = 26214400;
		const isAuthorizedVideo = (source) => source === "video" || source === "video-library";
		async function post(route, data, options = {}) {
			const response = await fetch(apiPath + route, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-personal-spirit": "1"
				},
				body: JSON.stringify(data),
				keepalive: options.keepalive,
				signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(7e3)]) : AbortSignal.timeout(7e3)
			});
			const decoded = await response.json();
			if (!response.ok) throw new Error(decoded.error ?? "视觉连接失败。");
			return decoded;
		}
		function remoteVideo(value) {
			const url = new URL(value.trim());
			if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error("请输入不包含登录信息的 HTTPS 直链视频。");
			return url.href;
		}
		async function downloadVideo(url, signal) {
			const response = await fetch(url, {
				credentials: "omit",
				redirect: "error",
				referrerPolicy: "no-referrer",
				signal: AbortSignal.any([signal, AbortSignal.timeout(15e3)])
			});
			const type = response.headers.get("content-type")?.split(";", 1)[0];
			if (!response.ok || !response.body || !type?.startsWith("video/")) {
				await response.body?.cancel();
				throw new Error("无法取得可直接播放的 HTTPS 视频。");
			}
			if (Number(response.headers.get("content-length")) > maxVideoBytes) {
				await response.body.cancel();
				throw new Error("所选视频超过 25 MiB。");
			}
			const reader = response.body.getReader(), chunks = [];
			let bytes = 0;
			try {
				for (;;) {
					const part = await reader.read();
					if (part.done) break;
					bytes += part.value.byteLength;
					if (bytes > maxVideoBytes) throw new Error("所选视频超过 25 MiB。");
					chunks.push(part.value);
				}
				return new Blob(chunks, { type });
			} catch (error) {
				await reader.cancel().catch(() => {});
				throw error;
			} finally {
				reader.releaseLock();
			}
		}
		function clearPlayer(value, element) {
			value.download?.abort();
			value.download = void 0;
			element.pause();
			element.removeAttribute("src");
			element.load();
			if (value.downloadedUrl) URL.revokeObjectURL(value.downloadedUrl);
			value.downloadedUrl = void 0;
		}
		function VisionControls({ paused = false, inPhone, callInProgress, open, panelId, onToggle, onWatchingChange }) {
			const [status, setStatus] = (0, react.useState)("");
			const [source, setSource] = (0, react.useState)();
			const [watching, setWatching] = (0, react.useState)(false);
			const [starting, setStarting] = (0, react.useState)(false);
			const [canSend, setCanSend] = (0, react.useState)(false);
			const [labels, setLabels] = (0, react.useState)([]);
			const [remote, setRemote] = (0, react.useState)("");
			const [libraryHost, setLibraryHost] = (0, react.useState)("upload.wikimedia.org");
			const video = (0, react.useRef)(null);
			const capture = (0, react.useRef)();
			const generation = (0, react.useRef)(0);
			const startingCapture = (0, react.useRef)();
			const pausedRef = (0, react.useRef)(paused);
			const inPhoneRef = (0, react.useRef)(inPhone);
			const wasCalling = (0, react.useRef)(callInProgress);
			pausedRef.current = paused;
			inPhoneRef.current = inPhone;
			const end = (0, react.useCallback)((keepalive = false) => {
				generation.current++;
				startingCapture.current?.controller.abort();
				const value = capture.current;
				capture.current = void 0;
				if (value) {
					window.clearInterval(value.timer);
					if (value.command?.action === "play") value.tab?.control("stop").catch(() => {});
					value.download?.abort();
					if (value.downloadedUrl) URL.revokeObjectURL(value.downloadedUrl);
					value.controller.abort();
					value.worker.terminate();
					for (const track of value.stream?.getTracks() ?? []) track.stop();
					if (value.objectUrl) URL.revokeObjectURL(value.objectUrl);
					post("/stop", { token: value.token }, { keepalive }).catch(() => {});
				}
				const element = video.current;
				if (value && element) {
					element.pause();
					element.srcObject = null;
					element.removeAttribute("src");
					element.load();
				}
				setSource(void 0);
				setCanSend(false);
				setLabels([]);
				setStarting(false);
				setWatching(false);
			}, []);
			(0, react.useEffect)(() => {
				const leave = () => end(true);
				window.addEventListener("pagehide", leave);
				return () => {
					window.removeEventListener("pagehide", leave);
					leave();
				};
			}, [end]);
			(0, react.useEffect)(() => {
				if (paused) {
					end();
					setStatus("");
				}
			}, [end, paused]);
			(0, react.useEffect)(() => {
				const hungUp = wasCalling.current && !callInProgress;
				wasCalling.current = callInProgress;
				if (inPhone && !hungUp) return;
				const source = capture.current?.source ?? startingCapture.current?.source;
				if (source && !isAuthorizedVideo(source)) {
					end();
					setStatus("视觉共享已结束。");
				}
			}, [
				end,
				inPhone,
				callInProgress
			]);
			(0, react.useEffect)(() => {
				onWatchingChange?.(watching);
			}, [watching, onWatchingChange]);
			const fail = (value, error) => {
				if (capture.current !== value || value.controller.signal.aborted) return;
				end();
				setStatus(error instanceof Error ? error.message : String(error));
			};
			const playbackEnded = async (value, failed = false) => {
				const command = value.command;
				if (!command || command.action !== "play" || capture.current !== value) return;
				value.command = void 0;
				value.lastCapturedAt = void 0;
				value.lastMediaTime = void 0;
				setWatching(false);
				setCanSend(false);
				setLabels([]);
				try {
					await post("/ended", {
						token: value.token,
						commandId: command.id,
						...failed ? { failed: true } : {}
					}, { signal: value.controller.signal });
				} catch (error) {
					fail(value, error);
				}
			};
			const playLocalOrRemote = async (value, element, command) => {
				const download = new AbortController();
				value.download = download;
				try {
					let url = value.objectUrl;
					if (!url) {
						const source = value.allowedHost && command.url ? permittedVideoUrl(command.url, value.allowedHost) : value.media;
						if (!source) throw new Error("没有已选择的视频。");
						const blob = await downloadVideo(source, AbortSignal.any([download.signal, value.controller.signal]));
						if (download.signal.aborted || value.command?.id !== command.id) return;
						url = URL.createObjectURL(blob);
						value.downloadedUrl = url;
					}
					element.removeAttribute("crossorigin");
					element.src = url;
					await element.play();
				} catch (error) {
					if (download.signal.aborted || capture.current !== value) return;
					clearPlayer(value, element);
					setStatus(error instanceof Error ? error.message : String(error));
					await playbackEnded(value, true);
				}
			};
			const sample = async (value, element, playerTime) => {
				if (!value.ready || value.pendingFrame || value.sending || element.paused || element.readyState < 2 || !element.videoWidth || !element.videoHeight) return;
				const mediaTime = element.currentTime;
				if (value.lastMediaTime === mediaTime) return;
				value.lastMediaTime = mediaTime;
				const capturedAt = Date.now(), timestamp = performance.now();
				const width = Math.min(480, element.videoWidth);
				const observedTime = isAuthorizedVideo(value.source) ? mediaTime : playerTime;
				value.pendingFrame = {
					capturedAt,
					...observedTime !== void 0 ? {
						mediaTime: observedTime,
						commandId: value.command?.id
					} : {}
				};
				let bitmap;
				try {
					bitmap = await createImageBitmap(element, {
						resizeWidth: width,
						resizeHeight: Math.max(1, Math.round(element.videoHeight * width / element.videoWidth)),
						resizeQuality: "low"
					});
					if (capture.current !== value) return;
					value.worker.postMessage({
						type: "detect",
						bitmap,
						timestamp
					}, [bitmap]);
					bitmap = void 0;
				} catch (error) {
					fail(value, error);
				} finally {
					bitmap?.close();
				}
			};
			const update = async (value, element) => {
				if (capture.current !== value || value.polling) return;
				value.polling = true;
				try {
					if (value.lastCapturedAt && Date.now() - value.lastCapturedAt > 3900) {
						value.lastCapturedAt = void 0;
						setCanSend(false);
						setLabels([]);
					}
					const controlsPlayer = isAuthorizedVideo(value.source) || value.tab;
					let playerTime;
					if (!controlsPlayer && Date.now() - (value.lastPollAt ?? 0) >= 2e3) {
						value.lastPollAt = Date.now();
						await post("/poll", { token: value.token }, { signal: value.controller.signal });
						if (capture.current !== value) return;
					}
					if (controlsPlayer) {
						const state = await post("/poll", { token: value.token }, { signal: value.controller.signal });
						if (capture.current !== value) return;
						setWatching(state.watching);
						const next = state.command;
						if (next?.id !== value.command?.id) {
							value.command = next;
							value.lastMediaTime = void 0;
							value.lastCapturedAt = void 0;
							setCanSend(false);
							setLabels([]);
							if (value.tab) {
								if (next) await value.tab.control(next.action);
							} else {
								clearPlayer(value, element);
								if (next?.action === "play" && next.expires > Date.now()) playLocalOrRemote(value, element, next);
							}
						}
						if (value.command?.action === "play" && value.command.expires <= Date.now()) {
							if (value.tab) await value.tab.control("stop");
							else clearPlayer(value, element);
							await playbackEnded(value);
						}
						if (value.tab) {
							const target = await value.tab.control("status");
							if (target.playing && value.command?.action === "play") playerTime = target.time;
						} else if (value.command?.action !== "play") return;
					}
					await sample(value, element, playerTime);
				} catch (error) {
					fail(value, error);
				} finally {
					value.polling = false;
				}
			};
			const start = async (requested, media) => {
				if (pausedRef.current || !inPhoneRef.current || capture.current || startingCapture.current) {
					if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl);
					return;
				}
				const epoch = ++generation.current;
				const controller = new AbortController();
				startingCapture.current = {
					source: requested,
					controller
				};
				setStarting(true);
				setStatus("");
				let stream, value, token;
				const canceled = () => generation.current !== epoch || pausedRef.current || !inPhoneRef.current && !isAuthorizedVideo(requested);
				const stopPendingTracks = () => {
					for (const track of stream?.getTracks() ?? []) track.stop();
				};
				controller.signal.addEventListener("abort", stopPendingTracks, { once: true });
				try {
					let selected = requested;
					let tab;
					if (requested === "camera") stream = await navigator.mediaDevices.getUserMedia({
						audio: false,
						video: {
							width: { ideal: 640 },
							height: { ideal: 480 }
						}
					});
					else if (!isAuthorizedVideo(requested)) {
						stream = await navigator.mediaDevices.getDisplayMedia({
							audio: false,
							video: requested === "video-tab" ? { displaySurface: "browser" } : true
						});
						const track = stream.getVideoTracks()[0];
						if (requested === "video-tab") {
							if (track?.getSettings().displaySurface !== "browser") selected = "screen";
							else if (track) {
								tab = await bindCapturedVideo(track, controller.signal);
								if (tab) selected = "tab-video";
							}
						}
					}
					if (canceled() || !video.current) return;
					const element = video.current;
					token = (await post("/start", {
						source: selected,
						allowedHost: media?.allowedHost
					})).token;
					if (canceled()) return;
					const worker = new Worker(apiPath + "/assets/detector.js");
					setStatus("正在加载本机视觉识别。");
					value = {
						token,
						source: selected,
						stream,
						media: media?.url,
						objectUrl: media?.objectUrl,
						allowedHost: media?.allowedHost,
						worker,
						tab,
						controller,
						ready: false,
						seq: 0
					};
					capture.current = value;
					const owned = value;
					worker.onerror = () => fail(owned, /* @__PURE__ */ new Error("无法启动本机视觉识别。"));
					worker.onmessage = (event) => {
						if (capture.current !== owned) return;
						const result = event.data;
						if (result.type === "ready") {
							owned.ready = true;
							setStatus(isAuthorizedVideo(selected) || selected === "tab-video" ? "视频已授权，由精神选择何时播放。" : "本机实时物体识别已开启。");
							return;
						}
						if (result.type === "error") return fail(owned, result.error ?? "本机识别失败。");
						const frame = owned.pendingFrame;
						owned.pendingFrame = void 0;
						if (!frame || Date.now() - frame.capturedAt > 3900) return;
						owned.sending = true;
						post("/frame", {
							token: owned.token,
							seq: ++owned.seq,
							...frame,
							detections: result.detections
						}, { signal: owned.controller.signal }).then(({ accepted }) => {
							if (accepted && capture.current === owned) {
								owned.lastCapturedAt = frame.capturedAt;
								setCanSend(true);
								setLabels([...new Set((result.detections ?? []).map((item) => item.label))]);
							}
						}).catch((error) => fail(owned, error)).finally(() => {
							owned.sending = false;
						});
					};
					worker.postMessage({ type: "init" });
					for (const track of stream?.getVideoTracks() ?? []) track.addEventListener("ended", () => {
						if (capture.current === owned) {
							end();
							setStatus("视觉共享已结束。");
						}
					}, { once: true });
					if (stream) {
						element.srcObject = stream;
						await element.play();
					}
					if (capture.current !== owned) return;
					setSource(selected);
					owned.timer = window.setInterval(() => {
						update(owned, element);
					}, cadence);
					update(owned, element);
				} catch (error) {
					if (value) fail(value, error);
					else if (generation.current === epoch) setStatus(error instanceof Error ? error.message : String(error));
				} finally {
					controller.signal.removeEventListener("abort", stopPendingTracks);
					if (!value) {
						if (token) post("/stop", { token }).catch(() => {});
						stopPendingTracks();
						if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl);
					}
					if (startingCapture.current?.controller === controller) startingCapture.current = void 0;
					if (generation.current === epoch) setStarting(false);
				}
			};
			const send = async () => {
				const value = capture.current, element = video.current;
				if (!value || !element || !inPhoneRef.current || pausedRef.current || element.paused || !value.lastCapturedAt || Date.now() - value.lastCapturedAt > 3900 || element.readyState < 2) return setStatus("暂时没有新画面可发送。");
				const capturedAt = Date.now();
				try {
					const canvas = document.createElement("canvas");
					canvas.width = Math.min(800, element.videoWidth);
					canvas.height = Math.round(element.videoHeight * canvas.width / element.videoWidth);
					const context = canvas.getContext("2d");
					if (!context) throw new Error("浏览器无法读取这帧画面。");
					context.drawImage(element, 0, 0, canvas.width, canvas.height);
					const jpeg = canvas.toDataURL("image/jpeg", .77);
					const data = jpeg.slice(23);
					if (!jpeg.startsWith("data:image/jpeg;base64,") || !data) throw new Error("浏览器无法编码当前画面。");
					await post("/image", {
						token: value.token,
						requestId: crypto.randomUUID(),
						capturedAt,
						data
					}, { signal: value.controller.signal });
					if (capture.current === value) setStatus("当前画面已发送到精神主会话。");
				} catch (error) {
					if (capture.current === value) setStatus(error instanceof Error ? error.message : String(error));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "spirit-vision",
				hidden: !inPhone,
				children: [inPhone && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "jingshen-icon",
					"data-capturing": !!source || void 0,
					title: source ? "视觉已开启" : "视觉",
					"aria-label": source ? "视觉已开启" : "视觉",
					"aria-controls": panelId,
					"aria-expanded": open,
					onClick: onToggle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { name: "camera" })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					id: panelId,
					hidden: !open,
					className: "spirit-vision-controls",
					children: [
						inPhone && !source && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
							disabled: paused || starting,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: "本机视觉" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "开启后，浏览器在本机识别物体。精神可以读取识别标签和位置。单独发送画面会把该帧存入主会话，并交给当前模型。" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => void start("camera"),
									children: "开启摄像头"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => void start("screen"),
									children: "共享屏幕"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => void start("video-tab"),
									children: "共享正在用的浏览器标签页"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["授权精神观看本地视频 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"aria-label": "授权精神观看本地视频",
									type: "file",
									accept: "video/*",
									onChange: (event) => {
										const file = event.currentTarget.files?.[0];
										event.currentTarget.value = "";
										if (file) {
											const url = URL.createObjectURL(file);
											start("video", {
												url,
												objectUrl: url
											});
										}
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["HTTPS 视频直链", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "url",
									value: remote,
									onChange: (event) => setRemote(event.target.value)
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: !remote.trim(),
									onClick: () => {
										try {
											start("video", { url: remoteVideo(remote) });
										} catch (error) {
											setStatus(error instanceof Error ? error.message : String(error));
										}
									},
									children: "授权精神观看网络视频"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["允许自行选片的 HTTPS 域名", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: libraryHost,
									onChange: (event) => setLibraryHost(event.target.value)
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										try {
											start("video-library", { allowedHost: videoHost(libraryHost) });
										} catch (error) {
											setStatus(error instanceof Error ? error.message : String(error));
										}
									},
									children: "授权精神从此域名选片"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "网页视频需允许跨域读取，网络短片上限 25 MiB。已登录的网页可共享画面。若要让精神控制网页播放器，先在 Harness 和该网页分别点击已安装的配套扩展图标，再共享该标签页。" })
							]
						}),
						inPhone && source && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								end();
								setStatus("视觉共享已结束。");
							},
							children: "停止视觉"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: !canSend || paused,
							onClick: () => void send(),
							children: "发送当前画面"
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
							ref: video,
							hidden: !source || isAuthorizedVideo(source) && !watching,
							muted: true,
							playsInline: true,
							"aria-label": "视觉预览",
							onEnded: () => {
								if (capture.current) playbackEnded(capture.current);
							},
							onError: () => {
								const value = capture.current;
								if (value && isAuthorizedVideo(value.source) && value.command?.action === "play") {
									if (video.current) clearPlayer(value, video.current);
									setStatus("浏览器无法播放此视频。可选择其他来源，或分享原浏览器标签页。");
									playbackEnded(value, true);
								}
							}
						}),
						inPhone && labels.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: ["当前识别 ", labels.join("、")] }),
						inPhone && status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							children: status
						})
					]
				})]
			});
		}
		// src/voice-protocol.ts
		const VOICE_PATH = "/personal-spirit/api/voice";
		const RECORD_RATE = 16e3;
		const PLAY_RATE = 24e3;
		// src/voice-audio.ts
		/** Keep a short pre-roll so the onset detector does not clip the first word. */
		var SpeechGate = class {
			begin;
			complete;
			calibrated;
			head = [];
			utterance = null;
			consecutive = 0;
			quiet = 0;
			floor = .001;
			calibration = [];
			constructor(begin, complete, calibrated) {
				this.begin = begin;
				this.complete = complete;
				this.calibrated = calibrated;
			}
			frame(frame, playback, voiced, thresholdDb) {
				let sum = 0;
				for (const sample of frame) sum += sample * sample;
				const energy = Math.sqrt(sum / frame.length);
				if (!voiced) this.floor += .04 * (energy - this.floor);
				if (this.calibration) {
					this.calibration.push(energy);
					if (this.calibration.length === 12) {
						this.calibration.sort((a, b) => a - b);
						this.floor = this.calibration[2];
						this.calibration = void 0;
						this.calibrated?.();
						this.consecutive = 0;
					}
				}
				const minimum = 10 ** ((thresholdDb + (this.utterance ? -5 : playback ? 5 : 0)) / 20);
				const audible = voiced && energy >= Math.max(minimum, this.floor * (this.utterance ? 1.35 : 2.2));
				if (!this.utterance) {
					this.head.push(frame);
					if (this.head.length > 24) this.head.shift();
					this.consecutive = audible ? this.consecutive + 1 : 0;
					if (this.calibration || this.consecutive < (playback ? 9 : 6)) return;
					this.utterance = this.head;
					this.head = [];
					this.quiet = 0;
					this.begin();
					return;
				}
				this.utterance.push(frame);
				this.quiet = audible ? 0 : this.quiet + 1;
				if (this.quiet < 38 && this.utterance.length < 1250) return;
				const utterance = this.utterance;
				this.utterance = null;
				this.consecutive = 0;
				this.complete(utterance);
			}
		};
		function encodeVoiceWav(frames, rate) {
			const total = frames.reduce((length, frame) => length + frame.length, 0);
			const source = new Float32Array(total);
			let index = 0;
			for (const frame of frames) {
				source.set(frame, index);
				index += frame.length;
			}
			const count = Math.min(RECORD_RATE * 25, Math.floor(total * RECORD_RATE / rate));
			const wav = /* @__PURE__ */ new ArrayBuffer(44 + count * 2), output = new DataView(wav);
			const fourcc = (at, value) => [...value].forEach((char, i) => output.setUint8(at + i, char.charCodeAt(0)));
			fourcc(0, "RIFF");
			output.setUint32(4, wav.byteLength - 8, true);
			fourcc(8, "WAVE");
			fourcc(12, "fmt ");
			output.setUint32(16, 16, true);
			output.setUint16(20, 1, true);
			output.setUint16(22, 1, true);
			output.setUint32(24, RECORD_RATE, true);
			output.setUint32(28, RECORD_RATE * 2, true);
			output.setUint16(32, 2, true);
			output.setUint16(34, 16, true);
			fourcc(36, "data");
			output.setUint32(40, count * 2, true);
			const ratio = rate / RECORD_RATE;
			for (let sample = 0; sample < count; sample++) {
				const start = Math.floor(sample * ratio), end = Math.max(start + 1, Math.floor((sample + 1) * ratio));
				let value = 0;
				for (let i = start; i < end; i++) value += source[i] ?? 0;
				output.setInt16(44 + sample * 2, Math.min(1, Math.max(-1, value / (end - start))) * 32767, true);
			}
			return wav;
		}
		function wait(ms, signal) {
			signal.throwIfAborted();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					signal.removeEventListener("abort", abort);
					resolve();
				}, ms);
				const abort = () => {
					clearTimeout(timer);
					reject(signal.reason);
				};
				signal.addEventListener("abort", abort, { once: true });
			});
		}
		/** Schedule small PCM blocks on the hardware clock and discard them on barge-in. */
		var PcmPlayer = class {
			context;
			sources = /* @__PURE__ */ new Set();
			end = 0;
			constructor(context) {
				this.context = context;
			}
			stop() {
				for (const source of this.sources) {
					source.onended = null;
					source.stop();
					source.disconnect();
				}
				this.sources.clear();
				this.end = 0;
			}
			queue(bytes, offsetBytes, playBytes) {
				const block = this.context.createBuffer(1, bytes.byteLength / 2, PLAY_RATE);
				const samples = block.getChannelData(0), pcm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				for (let index = 0; index < samples.length; index++) samples[index] = pcm.getInt16(index * 2, true) / 32768;
				const source = this.context.createBufferSource();
				source.buffer = block;
				source.connect(this.context.destination);
				const at = Math.max(this.end, this.context.currentTime + .045);
				const duration = playBytes / (2 * PLAY_RATE);
				source.start(at, offsetBytes / (2 * PLAY_RATE), duration);
				this.end = at + duration;
				this.sources.add(source);
				source.onended = () => {
					this.sources.delete(source);
					source.disconnect();
				};
			}
			async stream(body, signal, started) {
				const reader = body.getReader();
				const chunkBytes = PLAY_RATE / 10 * 2;
				const contextBytes = this.context.sampleRate === 24e3 ? 0 : 64;
				const lookaheadBytes = contextBytes ? 2 : 0;
				let carry = /* @__PURE__ */ new Uint8Array(0), first = true;
				let history = /* @__PURE__ */ new Uint8Array(0);
				const emit = (samples, following) => {
					if (contextBytes) {
						const block = new Uint8Array(history.length + samples.length + (following?.length ?? 0));
						block.set(history);
						block.set(samples, history.length);
						if (following?.length) block.set(following, history.length + samples.length);
						this.queue(block, history.length, samples.length);
						history = samples.slice(-contextBytes);
					} else this.queue(samples, 0, samples.length);
					if (first) {
						first = false;
						started();
					}
				};
				try {
					for (;;) {
						const next = await reader.read();
						signal.throwIfAborted();
						if (next.done) break;
						const bytes = new Uint8Array(carry.length + next.value.length);
						bytes.set(carry);
						bytes.set(next.value, carry.length);
						let index = 0;
						const pairedBytes = bytes.length - (bytes.length & 1);
						for (; index + chunkBytes + lookaheadBytes <= pairedBytes; index += chunkBytes) {
							while (this.end - this.context.currentTime > 1.5) await wait(55, signal);
							signal.throwIfAborted();
							const end = index + chunkBytes;
							emit(bytes.subarray(index, end), bytes.subarray(end, Math.min(end + contextBytes, pairedBytes)));
						}
						carry = bytes.slice(index);
					}
					if (carry.byteLength & 1) throw new Error("语音片段不完整");
					if (carry.length) emit(carry);
					while (this.end > this.context.currentTime) await wait(35, signal);
				} finally {
					reader.cancel().catch(() => {});
				}
			}
		};
		// src/speech-detector.ts
		let modulePromise;
		async function createSpeechDetector() {
			const script = new URL("/personal-spirit/assets/voice/vad/fvad.js", window.location.href);
			modulePromise ??= import(script.href).then((module) => module.default({ locateFile: (file) => new URL(file, script).href })).catch((error) => {
				modulePromise = void 0;
				throw error;
			});
			const wasm = await modulePromise;
			const instance = wasm._fvad_new();
			const count = 320;
			const address = wasm._malloc(count * 2);
			const close = () => {
				if (instance) wasm._fvad_free(instance);
				if (address) wasm._free(address);
			};
			if (!instance || !address || wasm._fvad_set_sample_rate(instance, 16e3) || wasm._fvad_set_mode(instance, 2)) {
				close();
				throw new Error("无法初始化人声检测");
			}
			return {
				close,
				voiced(frame) {
					const samples = wasm.HEAP16.subarray(address / 2, address / 2 + count);
					for (let i = 0; i < count; i++) {
						const start = Math.floor(i * frame.length / count);
						const end = Math.max(start + 1, Math.floor((i + 1) * frame.length / count));
						let sum = 0;
						for (let j = start; j < end; j++) sum += frame[j];
						samples[i] = Math.round(Math.max(-1, Math.min(1, sum / (end - start))) * 32767);
					}
					return wasm._fvad_process(instance, address, count) === 1;
				}
			};
		}
		// src/voice-device.ts
		function mandarinRank(language) {
			const tag = language.toLowerCase().replaceAll("_", "-");
			if (/^(zh|cmn)(?:-hans)?-cn(?:-|$)/u.test(tag)) return 2;
			if (/^cmn(?:-|$)|^zh-cmn(?:-|$)|^zh(?:-(?:hans|hant|tw|sg)(?:-(?:cn|tw|sg))?)?$/u.test(tag)) return 1;
			return 0;
		}
		function localVoice(voices, language) {
			let best;
			let priority = 0;
			for (const voice of voices) {
				if (voice.localService !== true) continue;
				const rank = language === "zh" ? mandarinRank(voice.lang) : Number(/^en(?:[-_]|$)/iu.test(voice.lang));
				if (!rank) continue;
				const candidate = rank * 2 + Number(voice.default);
				if (candidate > priority) {
					best = voice;
					priority = candidate;
				}
			}
			return best;
		}
		function deviceVoice(language) {
			if (typeof window.SpeechSynthesisUtterance !== "function") return;
			const voices = window.speechSynthesis?.getVoices() ?? [];
			return language ? localVoice(voices, language) : localVoice(voices, "zh") ?? localVoice(voices, "en");
		}
		function* devicePhrases(text) {
			let language;
			let start = 0;
			for (const match of text.matchAll(/\p{Script=Han}+|\p{Script=Latin}+/gu)) {
				const next = /\p{Script=Han}/u.test(match[0]) ? "zh" : "en";
				if (language && language !== next) {
					yield {
						text: text.slice(start, match.index),
						language
					};
					start = match.index;
				}
				language = next;
			}
			if (start < text.length) yield {
				text: text.slice(start),
				language
			};
		}
		async function speakOnDevice(message, voice, signal, started) {
			signal.throwIfAborted();
			const synth = window.speechSynthesis;
			const selected = synth?.getVoices().find((candidate) => candidate.localService === true && candidate.voiceURI === voice.voiceURI && candidate.lang === voice.lang);
			if (!selected) throw new Error("设备本机声线已不可用");
			await new Promise((resolve, reject) => {
				const speech = new SpeechSynthesisUtterance(message.text);
				speech.lang = selected.lang;
				speech.voice = selected;
				speech.rate = message.tone === "playful" ? 1.03 : message.tone === "serious" ? .88 : .94;
				speech.pitch = message.tone === "playful" ? 1.08 : 1.02;
				let timer = setTimeout(() => cancel(/* @__PURE__ */ new Error("设备朗读没有开始")), 8e3);
				function finish(error) {
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					speech.onstart = null;
					speech.onend = null;
					speech.onerror = null;
					if (error === void 0) resolve();
					else reject(error);
				}
				function cancel(error) {
					finish(error);
					synth.cancel();
				}
				const abort = () => cancel(signal.reason);
				speech.onstart = () => {
					clearTimeout(timer);
					timer = setTimeout(() => cancel(/* @__PURE__ */ new Error("设备朗读已超时")), Math.max(3e4, message.text.length * 1e3));
					started();
				};
				speech.onend = () => finish();
				speech.onerror = () => finish(/* @__PURE__ */ new Error("设备朗读失败"));
				signal.addEventListener("abort", abort, { once: true });
				try {
					synth.speak(speech);
				} catch (error) {
					finish(error);
				}
			});
		}
		// src/voice-client.tsx
		const labels$1 = {
			checking: "正在检查语音连接",
			idle: "语音未接通",
			connecting: "正在接通语音",
			calibrating: "正在适应环境声音",
			ready: "等你开口",
			listening: "正在聆听",
			muted: "已关闭麦克风",
			speaking: "精神正在说话",
			transcribing: "正在转写",
			disconnected: "语音连接已断开"
		};
		const initialState = {
			connected: false,
			listening: false,
			speaking: false,
			phase: "checking",
			label: labels$1.checking
		};
		const preferenceKey = "personal-spirit:voice-output";
		const breezeKeys = "https://breezeblue.ai/zh/app/developer/api-keys";
		const breezePreview = "https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2";
		const breezeUnavailable = "BreezeBlue 朗读不可用。请检查 Harness 凭据 BREEZE_API_KEY。";
		function loadOutputPreference() {
			try {
				const value = window.localStorage.getItem(preferenceKey);
				if (value === "host" || value === "system" || value === "input") return value;
			} catch {}
			return "auto";
		}
		function loadThreshold() {
			try {
				const value = window.localStorage.getItem("personal-spirit:mic-threshold-db");
				if (value && Number.isFinite(Number(value))) return Math.max(-54, Math.min(-24, Number(value)));
			} catch {}
			return -42;
		}
		function expectsBreeze(availability) {
			return availability?.setup?.kind === "breeze-key" || availability?.output?.provider === "breezeblue";
		}
		function chooseOutput(preference, neural, info, voice, breeze) {
			if (preference === "input") return;
			if (preference !== "system" && neural && (!breeze || info?.provider === "breezeblue")) return {
				kind: "host",
				info
			};
			if (voice && (preference === "system" || preference === "auto" && !breeze)) return {
				kind: "system",
				voice
			};
		}
		function outputLabel(output) {
			if (!output) return "仅语音转写";
			if (output.kind === "system") return `设备朗读 · ${output.voice.name}`;
			const { info } = output;
			return info ? `${info.name}（${info.location === "host-local" ? "宿主本机" : "远端服务"}）` : "宿主语音合成";
		}
		function missingDeviceVoice(language) {
			return language ? `设备没有本机${language === "en" ? "英语" : "普通话"}声线` : "设备没有本机普通话或英语声线";
		}
		var VoiceRequestError = class extends Error {
			status;
			code;
			constructor(message, status, code) {
				super(message);
				this.status = status;
				this.code = code;
			}
		};
		function breezeError(error) {
			if (error instanceof VoiceRequestError) {
				if (error.status === 402 || error.code === "breeze-credits" || /积分|余额|额度|credits?/i.test(error.message)) return {
					message: "BreezeBlue 积分不足。请到 BreezeBlue 检查余额后重新接通。",
					pause: true
				};
				if (error.status === 401 || error.status === 403 || error.code === "breeze-auth" || /认证|密钥|凭据|unauthorized|api key/i.test(error.message)) return {
					message: "BreezeBlue 认证失败。请检查 Harness 凭据 BREEZE_API_KEY 后重新接通。",
					pause: true
				};
				if (error.status === 429 || /请求过多|HTTP 429/i.test(error.message)) return {
					message: "BreezeBlue 请求过多，未能朗读这条回复。",
					pause: false
				};
			}
			return {
				message: "BreezeBlue 未能朗读这条回复。",
				pause: false
			};
		}
		async function voiceFetch(action, params = {}, init = {}) {
			const headers = new Headers(init.headers);
			headers.set("x-personal-spirit", "1");
			const query = new URLSearchParams(params).toString();
			const response = await fetch(`${VOICE_PATH}/${action}${query ? "?" + query : ""}`, {
				credentials: "same-origin",
				...init,
				headers
			});
			if (response.ok) return response;
			const error = await response.json().catch(() => ({}));
			throw new VoiceRequestError(error.error ?? "语音连接失败", response.status, error.code);
		}
		var VoiceTransport = class {
			changed;
			thresholdDb = loadThreshold();
			state = initialState;
			call;
			checkEpoch = 0;
			constructor(changed) {
				this.changed = changed;
			}
			update(update, phase) {
				const transcriptionOnly = this.call?.input && !this.call.output && (phase === "ready" || phase === "listening" || phase === "muted" || phase === "transcribing");
				this.state = {
					...this.state,
					...update,
					...phase ? {
						phase,
						label: transcriptionOnly ? `仅语音转写 · ${labels$1[phase]}` : labels$1[phase]
					} : {}
				};
				this.changed(this.state);
			}
			async check(signal) {
				const epoch = ++this.checkEpoch;
				try {
					const availability = await (await voiceFetch("status", {}, { signal })).json();
					if (epoch === this.checkEpoch && !signal?.aborted && !this.call) this.update({
						availability,
						error: void 0
					}, "idle");
				} catch (error) {
					if (epoch === this.checkEpoch && !signal?.aborted && !this.call) this.update({
						availability: void 0,
						error: error instanceof Error ? error.message : "无法检查语音服务"
					}, "disconnected");
				}
			}
			async connect(preference) {
				if (this.call) return;
				let context;
				try {
					context = new AudioContext();
				} catch {
					this.update({ error: "浏览器不支持通话所需的 Web Audio" }, "disconnected");
					return;
				}
				const call = {
					abort: new AbortController(),
					context,
					player: new PcmPlayer(context),
					input: false,
					preference,
					recording: false,
					framesPending: 0,
					lastSequence: 0,
					pending: [],
					utterances: Promise.resolve(),
					micEpoch: 0
				};
				this.call = call;
				this.update({
					error: void 0,
					outputError: void 0
				}, "connecting");
				try {
					await context.resume();
					const opened = await (await voiceFetch("call", {}, {
						method: "POST",
						signal: call.abort.signal
					})).json();
					call.id = opened.id;
					call.input = opened.input;
					if (this.call !== call) {
						this.sendHangup(call);
						return;
					}
					const availability = this.state.availability;
					const info = opened.setup?.kind === "breeze-key" ? null : opened.output === void 0 ? availability?.output : opened.output;
					const breeze = expectsBreeze(availability) || opened.setup?.kind === "breeze-key" || info?.provider === "breezeblue";
					if (availability && (opened.setup?.kind === "breeze-key" || info?.provider === "breezeblue" && availability.setup)) this.update({ availability: {
						...availability,
						output: opened.setup ? null : info ?? null,
						setup: opened.setup
					} });
					call.output = chooseOutput(preference, opened.neural, info ?? void 0, deviceVoice(), breeze);
					if (!call.output && (!opened.input || preference !== "auto" && preference !== "input")) throw new Error(breeze && preference !== "system" && preference !== "input" ? breezeUnavailable : "所选语音方式当前不可用，请检查语音");
					if (!call.output && preference === "auto" && availability?.output?.provider === "breezeblue") this.update({ outputError: breezeUnavailable });
					await this.events(call);
					if (this.call === call) this.hangup("语音连接已断开");
				} catch (error) {
					if (this.call === call) this.hangup(error instanceof Error ? error.message : "语音连接失败");
				}
			}
			async events(call) {
				const response = await voiceFetch("events", { call: call.id }, { signal: call.abort.signal });
				if (!response.body) throw new Error("无法读取语音连接");
				const reader = response.body.getReader(), decoder = new TextDecoder();
				let queue = "";
				let timer;
				try {
					for (;;) {
						clearTimeout(timer);
						timer = setTimeout(() => {
							if (this.call === call) this.hangup("语音连接超时");
						}, 24e3);
						const read = await reader.read();
						if (read.done || this.call !== call) return;
						queue += decoder.decode(read.value, { stream: true });
						const data = queue.split("\n");
						queue = data.pop() ?? "";
						if (queue.length > 1e6) throw new Error("语音连接数据无效");
						for (const line of data) if (line) this.receive(call, JSON.parse(line));
					}
				} finally {
					clearTimeout(timer);
					reader.cancel().catch(() => {});
				}
			}
			receive(call, event) {
				if (this.call !== call) return;
				if (event.type === "ready") {
					if (this.state.connected) return;
					this.update({
						connected: true,
						microphoneAvailable: call.input,
						outputLabel: outputLabel(call.output)
					}, "muted");
					if (call.input) this.unmute();
				} else if (event.type === "closed") this.hangup(event.reason);
				else if (event.type === "speech") {
					call.lastSequence = Math.max(event.message.sequence, call.lastSequence);
					if (!call.output) {
						this.update({ caption: event.message.text });
						this.media(call, event.message, "end");
						return;
					}
					call.pending.push(event.message);
					this.speakNext(call);
				}
			}
			media(call, message, state) {
				voiceFetch("playing", {
					call: call.id,
					message: message.id,
					state
				}, {
					method: "POST",
					signal: call.abort.signal
				}).catch(() => {});
			}
			async speakNext(call) {
				if (this.call !== call || call.playback || call.recording) return;
				const message = call.pending.shift();
				if (!message) return;
				this.update({ caption: message.text });
				const playback = {
					message,
					abort: new AbortController()
				};
				call.playback = playback;
				const signal = AbortSignal.any([call.abort.signal, playback.abort.signal]);
				const output = call.output;
				const host = output?.kind === "host" ? output.info : void 0;
				let started = false;
				let retryOnDevice = false;
				const start = () => {
					if (signal.aborted || this.call !== call || started) return;
					started = true;
					this.update({
						speaking: true,
						outputError: void 0
					}, "speaking");
					this.media(call, message, "start");
				};
				try {
					if (output?.kind === "system") {
						const missing = /* @__PURE__ */ new Set();
						for (const phrase of devicePhrases(message.text)) {
							signal.throwIfAborted();
							const voice = deviceVoice(phrase.language);
							if (!voice) {
								missing.add(phrase.language);
								continue;
							}
							this.update({ outputLabel: outputLabel({
								kind: "system",
								voice
							}) });
							await speakOnDevice({
								...message,
								text: phrase.text
							}, voice, signal, start);
						}
						if (missing.size && !signal.aborted) this.update({ outputError: [...missing].map(missingDeviceVoice).join("。") });
					} else if (output?.kind === "host") {
						const response = await voiceFetch("speech", {
							call: call.id,
							message: message.id
						}, { signal });
						if (!response.body || response.headers.get("x-spirit-pcm-rate") !== String(24e3)) throw new Error("无效的语音播放数据");
						await call.player.stream(response.body, signal, start);
					}
				} catch (error) {
					if (call.playback === playback) call.player.stop();
					if (!signal.aborted && this.call === call) {
						let voice;
						if (!started && host?.provider !== "breezeblue" && call.preference === "auto" && output?.kind === "host") for (const phrase of devicePhrases(message.text)) {
							voice = deviceVoice(phrase.language);
							if (voice) break;
						}
						if (host?.provider === "breezeblue") {
							const failure = breezeError(error);
							if (failure.pause) {
								call.output = void 0;
								const latest = call.pending.at(-1);
								if (latest) this.update({ caption: latest.text });
								for (const waiting of call.pending) this.media(call, waiting, "end");
								call.pending = [];
								if (call.input) this.update({
									outputLabel: outputLabel(),
									outputError: failure.message
								});
								else this.hangup(failure.message);
							} else this.update({ outputError: failure.message });
						} else if (voice) {
							call.output = {
								kind: "system",
								voice
							};
							this.update({ outputLabel: outputLabel(call.output) });
							retryOnDevice = true;
							call.pending.unshift(message);
						} else this.update({ error: error instanceof Error ? error.message : "语音播放失败" });
					}
				} finally {
					if (!retryOnDevice && this.call === call) this.media(call, message, "end");
					if (call.playback === playback) {
						call.playback = void 0;
						if (this.call === call) {
							this.update({ speaking: false }, this.restingPhase(call));
							this.speakNext(call);
						}
					}
				}
			}
			restingPhase(call) {
				if (this.state.speaking && call.playback) return "speaking";
				if (call.recording) return "listening";
				if (call.framesPending) return "transcribing";
				if (!call.microphone) return "muted";
				return call.microphone.calibrated ? "ready" : "calibrating";
			}
			bargeIn(call) {
				if (this.call !== call) return;
				call.recording = true;
				if (this.state.speaking && call.playback) this.interruptPlayback(call);
				else this.update({ error: void 0 }, "listening");
			}
			interrupt() {
				const call = this.call;
				if (call && this.state.speaking) this.interruptPlayback(call);
			}
			interruptPlayback(call) {
				const reading = call.playback?.message.id;
				call.pending = [];
				this.stopPlayback(call);
				this.update({ speaking: false }, this.restingPhase(call));
				voiceFetch("interrupt", {
					call: call.id,
					through: String(call.lastSequence),
					...reading ? { reading } : {}
				}, {
					method: "POST",
					signal: call.abort.signal
				}).catch(() => {});
			}
			stopPlayback(call) {
				const current = call.playback;
				call.playback = void 0;
				current?.abort.abort();
				call.player.stop();
			}
			sendFrames(call, frames) {
				if (this.call !== call) return;
				call.recording = false;
				const id = crypto.randomUUID();
				const audio = encodeVoiceWav(frames, call.context.sampleRate);
				call.framesPending++;
				this.update({ error: void 0 }, "transcribing");
				call.utterances = call.utterances.then(async () => {
					if (call.abort.signal.aborted) return;
					const result = await (await voiceFetch("audio", {
						call: call.id,
						request: id
					}, {
						method: "POST",
						signal: call.abort.signal,
						headers: { "content-type": "audio/wav" },
						body: audio
					})).json();
					if (this.call === call) this.update(result.text ? {
						heard: result.text,
						error: void 0
					} : {
						heard: void 0,
						error: "没听清这句话，请再说一次。"
					});
				}).catch((error) => {
					if (this.call === call) this.update({ error: error instanceof Error ? error.message : "语音转写失败" });
				}).finally(() => {
					call.framesPending--;
					if (this.call === call) {
						this.update({}, this.restingPhase(call));
						this.speakNext(call);
					}
				});
			}
			async unmute() {
				const call = this.call;
				if (!call?.input || call.microphone || this.state.microphoneOpening) return;
				const epoch = ++call.micEpoch;
				this.update({
					microphoneOpening: true,
					error: void 0
				});
				let detector;
				let stream;
				try {
					if (!navigator.mediaDevices?.getUserMedia || !call.context.audioWorklet) throw new Error("当前浏览器不支持此页面的麦克风录音");
					stream = await navigator.mediaDevices.getUserMedia({ audio: {
						channelCount: 1,
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: false
					} });
					if (this.call !== call || call.micEpoch !== epoch) {
						stream.getTracks().forEach((track) => track.stop());
						return;
					}
					call.openingStream = stream;
					await loadMicWorklet(call);
					if (this.call !== call || call.micEpoch !== epoch) return;
					detector = await createSpeechDetector().catch(() => {
						throw new Error("人声检测未能加载，请重新开麦");
					});
					if (this.call !== call || call.micEpoch !== epoch) {
						detector.close();
						return;
					}
					const vad = detector;
					const source = call.context.createMediaStreamSource(stream);
					const node = new AudioWorkletNode(call.context, "spirit-mic"), sink = call.context.createGain();
					sink.gain.value = 0;
					const mic = {
						stream,
						source,
						node,
						sink,
						detector,
						calibrated: false
					};
					const gate = new SpeechGate(() => this.bargeIn(call), (frames) => this.sendFrames(call, frames), () => {
						mic.calibrated = true;
						this.update({}, this.restingPhase(call));
					});
					node.port.onmessage = (event) => {
						if (this.call === call && call.micEpoch === epoch) gate.frame(event.data, this.state.speaking, vad.voiced(event.data), this.thresholdDb);
					};
					source.connect(node);
					node.connect(sink);
					sink.connect(call.context.destination);
					call.microphone = mic;
					detector = void 0;
					call.openingStream = void 0;
					for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => {
						if (this.call === call && call.micEpoch === epoch) {
							this.mute();
							this.update({ error: "麦克风已断开" });
						}
					}, { once: true });
					this.update({
						listening: true,
						microphoneOpening: false,
						error: void 0
					}, this.restingPhase(call));
				} catch (error) {
					detector?.close();
					if (this.call === call && call.micEpoch === epoch) {
						call.openingStream = void 0;
						stream?.getTracks().forEach((track) => track.stop());
						const reason = error instanceof DOMException && error.name === "NotAllowedError" ? "未获得麦克风权限" : error instanceof Error && error.message === "人声检测未能加载，请重新开麦" ? error.message : "无法打开麦克风";
						this.update({
							listening: false,
							microphoneOpening: false,
							error: reason
						}, this.restingPhase(call));
					}
				}
			}
			releaseMic(call) {
				call.micEpoch++;
				call.recording = false;
				call.openingStream?.getTracks().forEach((track) => track.stop());
				call.openingStream = void 0;
				const mic = call.microphone;
				call.microphone = void 0;
				if (!mic) return;
				mic.node.port.onmessage = null;
				mic.node.port.close();
				mic.detector.close();
				mic.source.disconnect();
				mic.node.disconnect();
				mic.sink.disconnect();
				mic.stream.getTracks().forEach((track) => track.stop());
			}
			mute() {
				const call = this.call;
				if (!call) return;
				this.releaseMic(call);
				this.update({
					listening: false,
					microphoneOpening: false,
					error: void 0
				}, this.restingPhase(call));
				this.speakNext(call);
			}
			sendHangup(call) {
				if (call.id) voiceFetch("hangup", { call: call.id }, {
					method: "POST",
					keepalive: true
				}).catch(() => {});
			}
			hangup(reason) {
				const call = this.call;
				if (!call) return;
				this.call = void 0;
				call.abort.abort();
				call.pending = [];
				this.stopPlayback(call);
				this.releaseMic(call);
				this.sendHangup(call);
				call.context.close().catch(() => {});
				this.update({
					connected: false,
					listening: false,
					speaking: false,
					error: reason,
					outputError: void 0,
					outputLabel: void 0,
					heard: void 0,
					caption: void 0,
					microphoneAvailable: void 0,
					microphoneOpening: void 0
				}, reason ? "disconnected" : "idle");
			}
		};
		const micWorklets = /* @__PURE__ */ new WeakMap();
		async function registerMicWorklet(call) {
			const script = await (await voiceFetch("worklet.js", {}, { signal: call.abort.signal })).blob();
			const url = URL.createObjectURL(script);
			try {
				await call.context.audioWorklet.addModule(url);
			} finally {
				URL.revokeObjectURL(url);
			}
		}
		function loadMicWorklet(call) {
			let worklet = micWorklets.get(call.context);
			if (!worklet) {
				worklet = registerMicWorklet(call).catch((error) => {
					micWorklets.delete(call.context);
					throw error;
				});
				micWorklets.set(call.context, worklet);
			}
			return worklet;
		}
		function VoiceSample({ src }) {
			const audio = (0, react.useRef)(null);
			const [playing, setPlaying] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const element = audio.current;
				return () => {
					if (element && !element.paused) element.pause();
				};
			}, []);
			const toggle = () => {
				const element = audio.current;
				if (!element) return;
				setError(false);
				if (element.paused) {
					element.currentTime = 0;
					element.play().catch((reason) => {
						if (reason?.name !== "AbortError") setError(true);
					});
				} else element.pause();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: toggle,
					"aria-pressed": playing,
					children: playing ? "停止试听" : "试听小肥鱼声线"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
					ref: audio,
					preload: "none",
					src,
					onPlaying: () => setPlaying(true),
					onPause: () => setPlaying(false),
					onEnded: () => setPlaying(false)
				}),
				error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					role: "status",
					children: "样音播放失败"
				})
			] });
		}
		function BreezeKeySetup({ missing, save, refresh }) {
			const field = (0, react.useRef)(null);
			const saving = (0, react.useRef)(false);
			const [editing, setEditing] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (editing) field.current?.focus();
			}, [editing]);
			async function submit(event) {
				event.preventDefault();
				if (saving.current || !field.current) return;
				const key = field.current.value.trim();
				field.current.value = "";
				if (!key) {
					setFailure("请输入 Breeze API 密钥。");
					return;
				}
				saving.current = true;
				setBusy(true);
				setFailure("");
				try {
					await save(key);
					await refresh();
					setEditing(false);
				} catch {
					setFailure("无法保存 Breeze 密钥，请重试。");
				} finally {
					saving.current = false;
					setBusy(false);
				}
			}
			if (!editing) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => setEditing(true),
				children: missing ? "配置 Breeze 密钥" : "更新 Breeze 密钥"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				onSubmit: (event) => void submit(event),
				"aria-busy": busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["Breeze API 密钥 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: field,
						type: "password",
						autoComplete: "off",
						autoCapitalize: "none",
						spellCheck: false,
						required: true,
						disabled: busy
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						disabled: busy,
						children: busy ? "正在保存" : "保存至 Harness"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: busy,
						onClick: () => {
							setFailure("");
							setEditing(false);
						},
						children: "取消"
					}),
					failure && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "alert",
						children: failure
					})
				]
			});
		}
		function VoiceCall({ active = true, optionsOpen = false, optionsId, onCallChange, saveBreezeKey }) {
			const [state, setState] = (0, react.useState)(initialState);
			const [transport] = (0, react.useState)(() => new VoiceTransport(setState));
			const [preference, setPreference] = (0, react.useState)(loadOutputPreference);
			const [threshold, setThreshold] = (0, react.useState)(transport.thresholdDb);
			const [systemVoice, setSystemVoice] = (0, react.useState)();
			(0, react.useEffect)(() => {
				const update = () => setSystemVoice(deviceVoice());
				const synth = window.speechSynthesis;
				synth?.addEventListener("voiceschanged", update);
				window.addEventListener("focus", update);
				update();
				return () => {
					synth?.removeEventListener("voiceschanged", update);
					window.removeEventListener("focus", update);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!active) {
					transport.hangup();
					return;
				}
				const controller = new AbortController();
				transport.check(controller.signal);
				return () => {
					controller.abort();
					transport.hangup();
				};
			}, [active, transport]);
			(0, react.useEffect)(() => {
				const hangup = () => transport.hangup();
				window.addEventListener("pagehide", hangup);
				return () => window.removeEventListener("pagehide", hangup);
			}, [transport]);
			(0, react.useEffect)(() => {
				onCallChange?.(state);
			}, [onCallChange, state]);
			const { availability, connected } = state;
			const hostOutput = availability?.output ?? void 0;
			const breeze = expectsBreeze(availability);
			const missingKey = availability?.setup?.kind === "breeze-key";
			const selected = chooseOutput(preference, !!hostOutput, hostOutput, systemVoice, breeze);
			const noDeviceVoice = missingDeviceVoice();
			const transcriptionOnly = !selected && (preference === "auto" || preference === "input") && !!availability?.input;
			const canConnect = active && !!availability?.active && (!!selected || transcriptionOnly);
			const sample = selected?.kind === "host" && hostOutput?.provider !== "breezeblue" && hostOutput?.location === "host-local" && hostOutput.voice === "xiaoyu" ? hostOutput.model === "jingshen-light" ? "xiaoyu-light-preview.mp3" : hostOutput.model === "jingshen-character" ? "xiaoyu-preview.mp3" : void 0 : void 0;
			const error = [state.outputError, state.error].filter(Boolean).join(" ");
			const idle = !connected && state.phase !== "connecting" && active;
			const showBreezeSetup = breeze && (idle || connected && preference !== "system" && !!state.outputError);
			const micOn = state.listening || state.microphoneOpening;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "spirit-voice",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "spirit-voice-status",
						"data-error": !!error || void 0,
						role: "status",
						children: error || (!active ? "当前无法通话" : state.microphoneOpening && !state.speaking ? "正在打开麦克风" : state.label)
					}),
					connected && state.heard && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "spirit-voice-heard",
						title: state.heard,
						children: ["刚听到：", state.heard]
					}),
					connected && state.caption && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "spirit-voice-caption",
						"aria-live": "polite",
						children: ["精神：", state.caption]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "spirit-voice-controls",
						children: connected || state.phase === "connecting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [connected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: () => micOn ? transport.mute() : void transport.unmute(),
							disabled: !state.microphoneAvailable,
							"data-mic-on": micOn || void 0,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { name: micOn ? "mic" : "muted" }), micOn ? "关麦" : "开麦"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							disabled: !state.speaking,
							onClick: () => transport.interrupt(),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { name: "stop" }), "打断朗读"]
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"data-action": "hangup",
							onClick: () => transport.hangup(),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { name: "hangup" }), "挂断"]
						})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"data-action": "connect",
							disabled: !canConnect,
							onClick: () => void transport.connect(preference),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { name: "phone" }), transcriptionOnly ? "仅转写并开麦" : availability?.input ? "接通并开麦" : "接通语音"]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						id: optionsId,
						className: "spirit-voice-options",
						"aria-label": "语音选项",
						hidden: !optionsOpen,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "语音选项" }), optionsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							idle && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-voice-option-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setSystemVoice(deviceVoice());
										transport.check();
									},
									children: "检查语音"
								}), sample && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VoiceSample, { src: `/personal-spirit/assets/voice/${sample}` }, sample)]
							}),
							(idle || connected) && availability && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-voice-providers",
								children: [
									availability.input && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
										"开口阈值 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "range",
											min: "-54",
											max: "-24",
											step: "1",
											value: threshold,
											"aria-label": "开口阈值",
											"aria-valuetext": threshold + " dBFS",
											onChange: (event) => {
												const value = Number(event.target.value);
												transport.thresholdDb = value;
												setThreshold(value);
												try {
													window.localStorage.setItem("personal-spirit:mic-threshold-db", String(value));
												} catch {}
											}
										}),
										" ",
										threshold,
										" dBFS（调高可减少误触）"
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["通话输出 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										"aria-label": "通话输出",
										value: preference,
										disabled: connected,
										onChange: (event) => {
											const value = event.target.value;
											setPreference(value);
											try {
												window.localStorage.setItem(preferenceKey, value);
											} catch {}
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "auto",
												children: "自动选择"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "host",
												disabled: !hostOutput && preference !== "host",
												children: "宿主语音合成"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "system",
												disabled: !systemVoice && preference !== "system",
												children: "设备朗读"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "input",
												disabled: !availability.input && preference !== "input",
												children: "仅语音转写"
											})
										]
									})] }),
									idle && (selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["通话声线 · ", outputLabel(selected)] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: transcriptionOnly ? "仅语音转写" : preference === "system" ? noDeviceVoice : missingKey ? "BreezeBlue 朗读未配置" : preference === "host" ? "宿主语音合成未配置" : "当前没有可用的通话语音" })),
									idle && !systemVoice && preference !== "system" && !breeze && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: noDeviceVoice }),
									availability.input ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"转写 · ",
										availability.input.name,
										"（",
										availability.input.location === "host-local" ? "宿主本机" : "远端服务",
										"）"
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "未配置语音转写" })
								]
							}),
							showBreezeSetup && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-voice-setup",
								children: [
									missingKey ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										"在 Harness 凭据中保存 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "BREEZE_API_KEY" }),
										"，再点「检查语音」。请勿把密钥发到聊天中。"
									] }) : idle && selected?.kind === "host" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "BreezeBlue 接收要朗读的回复文字，并按用量计费。" }) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: breezeKeys,
										target: "_blank",
										rel: "noopener noreferrer",
										children: "BreezeBlue API 密钥"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: breezePreview,
										target: "_blank",
										rel: "noopener noreferrer",
										children: "官方试听 · 大肥鱼（迷糊版）"
									}),
									idle && saveBreezeKey && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BreezeKeySetup, {
										missing: missingKey,
										save: saveBreezeKey,
										refresh: () => transport.check()
									})
								]
							}),
							connected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "spirit-voice-provider",
								role: "status",
								children: state.outputLabel
							})
						] })]
					})
				]
			});
		}
		// src/spirit-ui.css?raw
		var spirit_ui_default = ".jingshen-dock {\n  --ink: #202749;\n  --muted: #586485;\n  --quiet: #697491;\n  --iris: #464fae;\n  --navy: #343e91;\n  --line: #dde3f2;\n  --paper: #f5f7fd;\n  --move: cubic-bezier(.22, 1, .36, 1);\n  position: absolute;\n  inset: 0;\n  pointer-events: none !important;\n  color: var(--ink);\n  font-family: \"PingFang SC\", \"Noto Sans CJK SC\", \"Microsoft YaHei\", Inter, system-ui, sans-serif;\n  font-size: 14px;\n  line-height: 1.5;\n}\n.jingshen-dock *, .jingshen-dock *::before, .jingshen-dock *::after { box-sizing: border-box; }\n.jingshen-dock :focus-visible { outline: 2px solid #5b64cb; outline-offset: 3px; }\n.jingshen-dock button { font: inherit; cursor: pointer; }\n.jingshen-dock button:disabled { cursor: default; }\n.jingshen-launcher {\n  pointer-events: auto;\n  position: absolute;\n  right: calc(var(--jingshen-work-right) + 16px);\n  bottom: clamp(108px, 12vh, 144px);\n  z-index: 3;\n  display: grid;\n  place-items: center;\n  inline-size: clamp(87px, 9vw, 123px);\n  block-size: clamp(104px, 12vw, 158px);\n  padding: 4px;\n  border: 0;\n  border-radius: 25px;\n  background: transparent;\n  color: #fff;\n  isolation: isolate;\n  transform-origin: 50% 85%;\n  transition: transform 220ms var(--move), filter 220ms var(--move);\n  -webkit-tap-highlight-color: transparent;\n}\n.jingshen-launcher[hidden] { display: none; }\n.jingshen-launcher::after {\n  position: absolute;\n  z-index: -1;\n  inline-size: 68%;\n  block-size: 13%;\n  left: 16%;\n  bottom: 5%;\n  border-radius: 50%;\n  background: #414c9c;\n  filter: blur(12px);\n  opacity: .18;\n  content: \"\";\n}\n.jingshen-launcher:hover { transform: translateY(-3px) scale(1.035); }\n.jingshen-launcher:active { transform: scale(.97); }\n.jingshen-launcher-marker {\n  position: absolute;\n  top: 9%;\n  right: 4%;\n  min-width: 13px;\n  height: 13px;\n  padding: 0 2px;\n  display: grid;\n  place-items: center;\n  color: #fff;\n  font-size: 11px;\n  line-height: 1;\n  font-weight: 700;\n  border-radius: 20px;\n  background: #54a487;\n  border: 2px solid #fff;\n  box-shadow: 0 2px 8px #2d407134;\n}\n.jingshen-launcher-marker:has(> span) { top: auto; bottom: 11%; right: 15%; }\n.jingshen-launcher-marker:not(:has(> span)) { min-width: 23px; height: 23px; background: #4c55b8; }\n.jingshen-launcher-marker:is([data-status=\"thinking\"], [data-status=\"working\"]):has(> span) { background: #7273d5; }\n.jingshen-launcher-marker:is([data-status=\"sleep\"], [data-status=\"paused\"], [data-status=\"stopped\"]):has(> span) { background: #9e9bb1; }\n.jingshen-launcher-marker[data-status=\"error\"]:has(> span) { background: #bd715a; }\n.jingshen-window {\n  pointer-events: auto;\n  --anchor: calc(var(--jingshen-work-right) + clamp(104px, 10vw, 145px));\n  position: absolute;\n  z-index: 2;\n  right: var(--anchor);\n  bottom: clamp(88px, 10vh, 119px);\n  width: min(438px, calc(100% - var(--anchor) - 60px));\n  height: min(604px, calc(100% - 130px));\n  min-height: 300px;\n  display: flex;\n  flex-direction: column;\n  border: 1px solid #ccd6ee;\n  border-radius: 24px;\n  background: var(--paper);\n  box-shadow: 0 24px 62px #1d2a6529, 0 6px 20px #25397c1c, inset 0 1px 0 #fff;\n  transform-origin: calc(100% + 24px) 94%;\n  animation: jingshen-rise 230ms var(--move) both;\n}\n@keyframes jingshen-rise {\n  from { transform: translate(7px, 11px) scale(.965); opacity: 0; }\n  to { transform: none; opacity: 1; }\n}\n.jingshen-window::after {\n  position: absolute;\n  z-index: -1;\n  right: -6px;\n  bottom: 55px;\n  width: 14px;\n  height: 14px;\n  transform: rotate(45deg);\n  background: #fdfdff;\n  border-top: 1px solid #ccd6ee;\n  border-right: 1px solid #ccd6ee;\n  border-radius: 2px;\n  content: \"\";\n}\n.jingshen-window[data-view=\"manage\"] { width: min(576px, calc(100% - var(--anchor) - 60px)); }\n.jingshen-dock[data-active-call] .jingshen-launcher { visibility: hidden; pointer-events: none; }\n.jingshen-window[data-phone] {\n  top: 50%;\n  right: auto;\n  left: calc((100% + var(--jingshen-work-left) - var(--jingshen-work-right)) / 2);\n  bottom: auto;\n  width: min(1120px, calc((100% - var(--jingshen-work-left) - var(--jingshen-work-right)) * .82));\n  height: min(850px, 85%);\n  min-width: 0;\n  min-height: 0;\n  transform: translate(-50%, -50%);\n  animation: none;\n}\n.jingshen-window[data-phone]::after { display: none; }\n.jingshen-window[data-phone] .jingshen-header-avatar { display: none; }\n.jingshen-header {\n  display: flex;\n  align-items: center;\n  gap: 11px;\n  min-height: 67px;\n  padding: 10px 12px 10px 15px;\n  background: linear-gradient(108deg, #fcfdff 65%, #eef1ff 100%);\n  border-radius: 24px 24px 0 0;\n  border-bottom: 1px solid var(--line);\n}\n.jingshen-header-avatar {\n  inline-size: 42px;\n  block-size: 42px;\n  flex: none;\n  display: grid;\n  overflow: hidden;\n  border: 1px solid #d8def5;\n  border-radius: 15px;\n  background: linear-gradient(145deg, #e9f0ff, #f1eefe 88%);\n}\n.jingshen-header-avatar > * { min-width: 0; min-height: 0; }\n.jingshen-header-text { flex: 1; min-width: 0; }\n.jingshen-header h1 { margin: 0; color: var(--ink); font-size: 16px; line-height: 1.4; font-weight: 680; }\n.jingshen-header h1:focus-visible { outline: none; }\n.jingshen-status { display: flex; align-items: center; gap: 6px; margin-top: 4px; min-width: 0; color: var(--muted); font-size: 11px; white-space: nowrap; }\n.jingshen-status > span { inline-size: 6px; block-size: 6px; flex: none; border-radius: 50%; background: #949bb7; }\n.jingshen-status:is([data-state=\"idle\"], [data-state=\"phone\"]) > span { background: #5c9d85; }\n.jingshen-status:is([data-state=\"working\"], [data-state=\"thinking\"]) > span { background: #7776c9; }\n.jingshen-status > small {\n  min-width: 0;\n  overflow: hidden;\n  margin-inline-start: 2px;\n  padding-inline-start: 8px;\n  border-inline-start: 1px solid #d1d6e8;\n  text-overflow: ellipsis;\n  color: var(--quiet);\n  font-size: inherit;\n}\n.jingshen-header-actions { display: flex; gap: 3px; margin-inline-start: auto; }\n.jingshen-icon {\n  display: grid;\n  place-items: center;\n  flex: none;\n  width: 35px;\n  height: 35px;\n  padding: 0;\n  border: 0;\n  border-radius: 11px;\n  color: var(--muted);\n  background: transparent;\n}\n.jingshen-icon:hover:not(:disabled) { background: #e8ecfb; color: var(--navy); }\n.jingshen-icon:disabled { opacity: .38; }\n.jingshen-window-main {\n  position: relative;\n  min-height: 0;\n  flex: 1 1 auto;\n  display: flex;\n  flex-direction: column;\n}\n.jingshen-transcript {\n  flex: 1 1 auto;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  min-height: 0;\n  padding: 14px 17px 21px;\n  scrollbar-color: #bcc7e3 transparent;\n  scrollbar-width: thin;\n  background:\n    radial-gradient(ellipse at 98% -28%, #eaf0ff 0, transparent 58%),\n    repeating-linear-gradient(0deg, transparent 0 35px, #d3ddf329 35px 36px),\n    #f5f7fd;\n}\n.jingshen-transcript:focus-visible { outline-offset: -3px; }\n.jingshen-date {\n  display: grid;\n  grid-template-columns: 1fr auto 1fr;\n  align-items: center;\n  gap: 9px;\n  margin: 11px 0 17px;\n  color: #626f91;\n  font-size: 11px;\n}\n.jingshen-date::before, .jingshen-date::after { height: 1px; background: #dde5f4; content: \"\"; }\n.jingshen-message { display: flex; flex-direction: column; align-items: flex-start; margin: 0 0 15px; }\n.jingshen-message[data-author=\"owner\"] { align-items: flex-end; }\n.jingshen-bubble {\n  min-width: 24px;\n  max-width: 89%;\n  padding: 10px 13px;\n  border: 1px solid #dce4f4;\n  border-radius: 4px 15px 15px 15px;\n  background: #fff;\n  color: #293454;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  font-size: 13.5px;\n  line-height: 1.68;\n  box-shadow: 0 2px 4px #596c9920;\n}\n.jingshen-message[data-author=\"owner\"] .jingshen-bubble {\n  background: #4a53a9;\n  border-color: #454fa5;\n  border-radius: 15px 4px 15px 15px;\n  color: #fff;\n}\n.jingshen-message-meta { display: flex; align-items: center; gap: 7px; margin: 4px 3px 0; color: #646f8d; font-size: 10px; }\n.jingshen-message-meta button {\n  padding: 1px 4px;\n  border: none;\n  background: #e9edf8;\n  border-radius: 4px;\n  font-size: 10px;\n  color: #4b5690;\n}\n.jingshen-message-meta button:hover { background: #e0e6f8; }\n.jingshen-empty { min-height: 100%; display: grid; align-content: center; justify-items: center; text-align: center; gap: 6px; padding: 18px; }\n.jingshen-empty-icon {\n  display: grid;\n  place-items: center;\n  width: 59px;\n  height: 59px;\n  margin-bottom: 10px;\n  border: 1px solid #dde5fb;\n  border-radius: 21px;\n  background: linear-gradient(145deg, #edf3ff, #e8eaff);\n  color: #6169b9;\n  box-shadow: inset 0 1px 1px #fff, 0 6px 16px #7183c217;\n}\n.jingshen-empty-icon svg { width: 26px; height: 26px; }\n.jingshen-empty p { margin: 0; color: var(--ink); font-size: 14px; font-weight: 620; }\n.jingshen-empty small { color: var(--muted); font-size: 12px; }\n.jingshen-history { display: flex; flex-direction: column; align-items: center; color: var(--muted); margin-bottom: 10px; }\n.jingshen-history button, .jingshen-jump {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  padding: 5px 11px;\n  border: 1px solid #d2ddf3;\n  border-radius: 999px;\n  background: #fbfcff;\n  color: #4d5990;\n  font-size: 11px;\n}\n.jingshen-history button:hover, .jingshen-jump:hover { background: #eaeffc; }\n.jingshen-history button svg { width: 14px; height: 14px; }\n.jingshen-jump { position: absolute; right: 15px; bottom: 12px; box-shadow: 0 3px 10px #283d6e26; }\n.jingshen-footer {\n  flex: none;\n  padding: 7px 12px 12px;\n  border-top: 1px solid var(--line);\n  border-radius: 0 0 24px 24px;\n  background: #fdfdff;\n}\n.jingshen-footer[hidden] { display: none; }\n.jingshen-compose-box { display: flex; align-items: flex-end; gap: 6px; padding: 4px; border: 1px solid #d7dff2; border-radius: 15px; background: #f8faff; }\n.jingshen-compose-box:focus-within { border-color: #9298d8; background: #fff; }\n.jingshen-compose textarea {\n  width: 100%;\n  min-height: 34px;\n  max-height: 125px;\n  align-self: center;\n  min-width: 0;\n  resize: none;\n  field-sizing: content;\n  overflow-y: auto;\n  outline: none !important;\n  padding: 7px 8px;\n  border: 0;\n  color: var(--ink);\n  background: transparent;\n  font: inherit;\n  line-height: 1.45;\n}\n.jingshen-compose textarea::placeholder { color: #65718d; }\n.jingshen-send {\n  display: grid;\n  place-items: center;\n  flex: none;\n  width: 35px;\n  height: 35px;\n  padding: 0;\n  border: 0;\n  border-radius: 11px;\n  background: #4d57b1;\n  color: #fff;\n}\n.jingshen-send:hover:not(:disabled) { background: #3d479b; }\n.jingshen-send:disabled { background: #e5eaf8; color: #61709f; }\n.jingshen-compose p, .jingshen-notice { margin: 6px 2px 0; color: #934929; font-size: 12px; }\n.jingshen-notice { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin: 0; padding: 7px 12px; background: #fff4ea; border-top: 1px solid #f1d6c2; }\n.jingshen-notice button { flex: none; padding: 3px 8px; color: inherit; border: 1px solid #dfbfa9; border-radius: 7px; background: #fffaf5; }\n.jingshen-management, .jingshen-model-view {\n  min-height: 0;\n  overflow: auto;\n  flex: 1;\n  overscroll-behavior: contain;\n  border-radius: 0 0 23px 23px;\n  scrollbar-width: thin;\n  scrollbar-color: #bcc7e3 transparent;\n}\n.jingshen-management .spirit-content { padding: 12px 13px; }\n.jingshen-management .spirit-overview { grid-template-columns: 1fr; }\n.jingshen-model-view { background: linear-gradient(180deg, #f6f8fe, #f0f3fa); padding: 17px; }\n.jingshen-model-form { display: grid; gap: 15px; margin: 0; color: var(--ink); }\n.jingshen-model-form label { display: grid; gap: 5px; font-size: 13px; }\n.jingshen-model-form :is(select, button) { min-height: 37px; padding: 6px 9px; border: 1px solid #cbd5ee; border-radius: 9px; background: #fff; color: var(--ink); font: inherit; }\n.jingshen-model-form button { justify-self: start; }\n.jingshen-model-form button:disabled { opacity: .55; }\n.jingshen-model-form [role=\"alert\"] { margin: 0; color: #934929; }\n.jingshen-model-form p { margin: 0; color: var(--muted); font-size: 13px; }\n.jingshen-call-scene {\n  min-height: 0;\n  flex: 1;\n  display: grid;\n  position: relative;\n  grid-template-rows: minmax(0, 1fr) auto;\n  gap: 4px;\n  align-items: center;\n  justify-items: center;\n  overflow: hidden;\n  padding: 12px 16px 21px;\n  border-radius: 0 0 23px 23px;\n  background: radial-gradient(ellipse at center, #fbfdff 0 17%, #e9edfd 56%, #eef3ff 100%);\n}\n.jingshen-call-orbit {\n  position: relative;\n  width: 100%;\n  height: 100%;\n  container-type: size;\n}\n.jingshen-call-orbit::before {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  width: min(84cqh, 75cqw, 470px);\n  aspect-ratio: 1;\n  border-radius: 50%;\n  transform: translate(-50%, -50%);\n  border: 1px solid #d9e2fa;\n  box-shadow: 0 0 0 24px #f9faff70, 0 0 0 25px #d9e2fa88;\n  content: \"\";\n}\n.jingshen-call-orbit .spirit-fish {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  width: min(100%, 510px);\n  height: min(100%, 510px);\n  transform: translate(-50%, -50%);\n}\n.spirit-voice {\n  display: grid;\n  justify-items: center;\n  gap: 9px;\n  z-index: 1;\n  min-width: 0;\n  max-width: min(100%, 520px);\n  text-align: center;\n}\n.spirit-voice-status {\n  margin: 0;\n  padding: 3px 9px;\n  border-radius: 9px;\n  color: var(--muted);\n  background: #f5f7fdd9;\n  font-size: 12px;\n}\n.spirit-voice-status[data-error] { color: #934929; }\n.spirit-voice-heard, .spirit-voice-caption {\n  margin: 0;\n  max-width: 100%;\n  max-height: 3.2em;\n  overflow: auto;\n  overflow-wrap: anywhere;\n  color: var(--ink);\n  font-size: 13px;\n  line-height: 1.6;\n}\n.spirit-voice-controls { display: flex; justify-content: center; gap: 10px 18px; }\n.spirit-voice-controls > button {\n  display: grid;\n  justify-items: center;\n  align-content: start;\n  gap: 4px;\n  min-width: 56px;\n  padding: 1px 0;\n  border: 0;\n  border-radius: 12px;\n  color: var(--ink);\n  background: transparent;\n  font-size: 12px;\n}\n.spirit-voice-controls > button:disabled { opacity: .46; }\n.spirit-voice-controls > button > svg {\n  width: 48px;\n  height: 48px;\n  padding: 13px;\n  border-radius: 50%;\n  background: #fbfcff;\n  box-shadow: 0 2px 7px #384a921d;\n}\n.spirit-voice-controls > button:not(:disabled):hover > svg { background: #dfe6ff; }\n.spirit-voice-controls > button[data-mic-on] > svg { background: #d8edeb; }\n.spirit-voice-controls > button[data-action=\"connect\"] > svg { background: #4d57b1; color: #fff; }\n.spirit-voice-controls > button[data-action=\"hangup\"] > svg { background: #a13558; color: #fff; }\n.spirit-voice-controls > button[data-action=\"connect\"]:not(:disabled):hover > svg { background: #3d479b; }\n.spirit-voice-controls > button[data-action=\"hangup\"]:hover > svg { background: #882a48; }\n.jingshen-icon:is([aria-expanded=\"true\"], [data-capturing]) { background: #e2e9ff; color: var(--navy); }\n.jingshen-mediation-badge { display: inline-block; margin: 4px 0 0; white-space: nowrap; color: inherit; font-size: 11px; padding: 2px 6px; border: 1px solid #8599ee55; border-radius: 6px; background: #8599ee16; }\n@media (max-width: 650px), (pointer: coarse) and (max-width: 950px) {\n  .jingshen-launcher {\n    right: max(11px, env(safe-area-inset-right));\n    bottom: max(110px, calc(91px + env(safe-area-inset-bottom)));\n    width: 90px;\n    height: 112px;\n  }\n  .jingshen-launcher[aria-expanded=\"true\"] { opacity: 0; pointer-events: none; }\n  .jingshen-window, .jingshen-window[data-phone], .jingshen-window[data-view=\"manage\"] {\n    right: max(8px, env(safe-area-inset-right));\n    left: max(8px, env(safe-area-inset-left));\n    width: auto;\n    bottom: calc(max(8px, env(safe-area-inset-bottom)) + var(--jingshen-keyboard-inset, 0px));\n    max-height: calc(100% - 53px);\n    height: min(780px, calc(var(--jingshen-visible-height, 100dvh) - 56px));\n    min-height: 0;\n    border-radius: 20px;\n    transform-origin: 87% 96%;\n    z-index: 4;\n  }\n  .jingshen-window[data-phone] {\n    top: auto;\n    left: max(4px, env(safe-area-inset-left));\n    right: max(4px, env(safe-area-inset-right));\n    bottom: max(4px, env(safe-area-inset-bottom));\n    width: auto;\n    height: calc(var(--jingshen-visible-height, 100dvh) - 12px);\n    max-height: calc(100% - 12px);\n    transform: none;\n  }\n  .jingshen-window::after { display: none; }\n  .jingshen-call-scene { padding-bottom: 15px; }\n  .jingshen-header { min-height: 62px; border-radius: 20px 20px 0 0; }\n  .jingshen-header-actions { gap: 2px; }\n  .jingshen-icon { width: 40px; height: 40px; }\n  .jingshen-send { width: 40px; height: 40px; }\n  .jingshen-footer { border-radius: 0 0 20px 20px; }\n  .jingshen-compose textarea { font-size: 16px; }\n  .jingshen-transcript { padding-inline: 14px; }\n}\n@media (max-height: 550px) and (min-width: 651px) and (pointer: fine) {\n  .jingshen-window:not([data-phone]) { bottom: 12px; height: calc(100% - 24px); min-height: 0; }\n  .jingshen-launcher { bottom: 77px; }\n}\n@media (prefers-reduced-motion: reduce) {\n  .jingshen-window { animation: none; }\n  .jingshen-launcher { transition: none; }\n}\n.spirit-voice-options, .spirit-vision-controls {\n  position: absolute;\n  z-index: 5;\n  inset: 8px 12px auto;\n  width: min(360px, calc(100% - 24px));\n  margin-inline-start: auto;\n  max-height: calc(100% - 20px);\n  padding: 12px;\n  overflow: auto;\n  overscroll-behavior: contain;\n  border: 1px solid #ccd7ee;\n  border-radius: 13px;\n  background: #fdfdff;\n  box-shadow: 0 10px 35px #25366026;\n  color: var(--muted);\n  text-align: start;\n  font-size: 12px;\n}\n.spirit-vision-controls { inset-block-start: 69px; max-height: calc(100% - 83px); }\n.spirit-vision[hidden], .spirit-vision-controls[hidden], .spirit-voice-options[hidden] { display: none; }\n.spirit-voice-options h2 { margin: 0 0 7px; color: var(--ink); font-size: 14px; font-weight: 650; }\n.spirit-voice-options p { margin: 0; }\n.spirit-voice-option-actions, .spirit-voice-setup, .spirit-voice-setup form {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 6px 8px;\n}\n.spirit-voice-providers { display: grid; gap: 5px; margin-top: 8px; }\n.spirit-voice-providers label { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }\n.spirit-voice-setup { margin-top: 8px; }\n.spirit-voice-setup :is(p, form) { flex-basis: 100%; }\n.spirit-voice-setup a { color: #394889; text-underline-offset: 2px; }\n.spirit-voice-setup :is(input, label) { max-width: 100%; }\n:is(.spirit-voice-options, .spirit-vision-controls) :is(button, select) {\n  max-width: 100%;\n  padding: 3px 8px;\n  min-height: 28px;\n  border: 1px solid #dce4f6;\n  border-radius: 7px;\n  background: #f7f9ff;\n  color: #394889;\n  font: inherit;\n}\n:is(.spirit-voice-options, .spirit-vision-controls) button:hover:not(:disabled) { background: #e7edff; }\n:is(.spirit-voice-options, .spirit-vision-controls) button:disabled { opacity: .6; }\n.spirit-vision-controls legend { color: var(--ink); font-weight: 650; }\n.spirit-vision-controls fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }\n.spirit-vision-controls fieldset p { margin: 3px 0 8px; }\n.spirit-vision-controls label { display: grid; gap: 3px; margin-block: 8px; }\n.spirit-vision-controls input { max-width: 100%; color: var(--ink); }\n.spirit-vision-controls button { margin: 0 4px 4px 0; }\n.spirit-vision-controls video { max-width: 100%; max-height: 180px; border-radius: 8px; }\n.jingshen-management > .spirit { padding: 13px; border-radius: 0 0 23px 23px; overflow: visible; }\n.jingshen-management .spirit-content { padding: 0; }\n.jingshen-management .spirit-card { border-color: #dfe5f1; padding: 13px 16px; }\n.jingshen-management .spirit-header { margin-bottom: 12px; }\n.jingshen-management .spirit-header:has(> .spirit-actions:only-child) { justify-content: flex-end; }\n\n.jingshen-window[hidden], .jingshen-native-interactions[hidden], .jingshen-native-interactions:empty { display: none; }\n.jingshen-approval-marker {\n  position: absolute;\n  top: 9%;\n  left: 12%;\n  min-width: 22px;\n  height: 22px;\n  display: grid;\n  place-items: center;\n  padding: 0 3px;\n  border: 2px solid #fff;\n  border-radius: 20px;\n  color: #fff;\n  background: #95533f;\n  box-shadow: 0 2px 8px #2d407134;\n  font-size: 11px;\n  font-weight: 750;\n}\n.jingshen-native-interactions {\n  z-index: 1;\n  max-height: min(45%, 290px);\n  flex: none;\n  overflow: auto;\n  overscroll-behavior: contain;\n  padding: 7px 11px 9px;\n  border-top: 1px solid var(--line);\n  background: #fbfcff;\n}\n.jingshen-window[data-phone] .jingshen-native-interactions {\n  position: absolute;\n  inset: auto max(12px, calc((100% - 490px) / 2)) 82px;\n  border: 1px solid #ccd7ee;\n  border-radius: 12px;\n  box-shadow: 0 6px 22px #25366026;\n}\n\n.jingshen-pending-link {\n  align-self: center;\n  min-height: 28px;\n  padding: 3px 8px;\n  border: 1px solid #ecd1c6;\n  border-radius: 8px;\n  color: #843d30;\n  background: #fff5ed;\n  font-size: 11px !important;\n  white-space: nowrap;\n}\n.jingshen-pending-link:hover { background: #fce8dc; }\n";
		// src/spirit-ui.tsx
		const activityLabels = {
			idle: "在线",
			thinking: "在思考",
			working: "工作中",
			observing: "在看画面",
			phone: "通话中",
			sleep: "休息中",
			paused: "已暂停",
			stopped: "已停止"
		};
		const expressionMoods = {
			smile: "smile",
			wave: "warm",
			thoughtful: "curious",
			excited: "surprise",
			sad: "sad"
		};
		const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
			month: "long",
			day: "numeric"
		});
		const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
			hour: "2-digit",
			minute: "2-digit"
		});
		const localReadKey = (id) => `dsh-jingshen-read:${id}`;
		const messageOf = (error) => error instanceof Error ? error.message : String(error);
		var SpiritHttpError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.status = status;
			}
		};
		async function spiritRequest(path, payload, signal) {
			const timeout = AbortSignal.timeout(15e3);
			const response = await fetch(`/personal-spirit/api/${path}`, {
				credentials: "same-origin",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
				headers: {
					"x-personal-spirit": "1",
					...payload === void 0 ? {} : { "content-type": "application/json" }
				},
				...payload === void 0 ? {} : {
					method: "POST",
					body: JSON.stringify(payload)
				}
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
				throw new SpiritHttpError(response.status, message);
			}
			if (value === void 0) throw new Error("宿主返回了无法读取的数据。");
			return value;
		}
		const failureOf = (error) => ({
			...error instanceof SpiritHttpError ? { status: error.status } : {},
			message: messageOf(error)
		});
		const isAuthorized = (error) => error?.status !== 403 && error?.status !== 401;
		function parseChat(value) {
			if (!value || typeof value.mainId !== "string" || !Number.isSafeInteger(value.cursor) || !Array.isArray(value.messages) || value.messages.some((row) => !row || !Number.isSafeInteger(row.cursor) || typeof row.id !== "string" || !["owner", "spirit"].includes(row.author) || typeof row.text !== "string" || typeof row.at !== "string" || !row.source || typeof row.source.sessionId !== "string") || !value.presence || !Object.hasOwn(activityLabels, value.presence.activity?.kind)) throw new Error("通讯记录格式无法读取。");
			return value;
		}
		function mergeMessages(previous, incoming) {
			if (!incoming.length) return previous;
			const byId = new Map(previous.map((row) => [row.id, row]));
			for (const row of incoming) byId.set(row.id, row);
			return [...byId.values()].sort((left, right) => left.cursor - right.cursor);
		}
		function readCursor(sessionId) {
			try {
				const raw = localStorage.getItem(localReadKey(sessionId));
				const cursor = raw === null ? void 0 : Number(raw);
				return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : void 0;
			} catch {
				return;
			}
		}
		function rememberCursor(sessionId, cursor) {
			try {
				localStorage.setItem(localReadKey(sessionId), String(cursor));
			} catch {}
		}
		function useSpiritChat(open) {
			const [data, setData] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			const [olderError, setOlderError] = (0, react.useState)();
			const [olderBusy, setOlderBusy] = (0, react.useState)(false);
			const [cycle, setCycle] = (0, react.useState)(0);
			const [unread, setUnread] = (0, react.useState)(0);
			const [publication, setPublication] = (0, react.useState)();
			const seen = (0, react.useRef)();
			const live = (0, react.useRef)();
			const older = (0, react.useRef)();
			const acknowledge = (0, react.useCallback)(() => {
				if (!live.current) return;
				const { mainId, cursor } = live.current;
				seen.current = {
					sessionId: mainId,
					cursor
				};
				rememberCursor(mainId, cursor);
				setUnread(0);
			}, []);
			const refresh = (0, react.useCallback)(() => setCycle((value) => value + 1), []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let timer;
				const read = async () => {
					try {
						const before = live.current;
						const value = parseChat(await spiritRequest(`chat${before ? `?after=${before.cursor}&limit=50` : "?limit=40"}`, void 0, controller.signal));
						if (controller.signal.aborted) return;
						const current = live.current;
						const sameSession = current?.mainId === value.mainId;
						const next = sameSession ? {
							...value,
							messages: mergeMessages(current.messages, value.messages),
							hasMore: current.hasMore,
							nextBefore: current.nextBefore
						} : value;
						live.current = next;
						setData(next);
						setError(void 0);
						const published = sameSession && value.messages.findLast((row) => row.author === "spirit" && row.cursor > current.cursor);
						if (published) {
							const expression = value.presence.expression;
							setPublication({
								duration: Math.max(700, Math.min(2400, published.text.length * 30)),
								mood: expression && Date.parse(expression.until) > Date.now() ? expressionMoods[expression.kind] : void 0
							});
						}
						if (seen.current?.sessionId !== value.mainId) seen.current = {
							sessionId: value.mainId,
							cursor: readCursor(value.mainId) ?? value.cursor
						};
						const unreadCursor = seen.current.cursor;
						setUnread(next.messages.filter((row) => row.author === "spirit" && row.cursor > unreadCursor).length);
						if (sameSession && value.hasMore && value.messages.length && value.cursor > (before?.cursor ?? 0)) {
							timer = window.setTimeout(() => void read(), 50);
							return;
						}
					} catch (reason) {
						if (!controller.signal.aborted) {
							const next = failureOf(reason);
							setError(next);
							if (!isAuthorized(next)) {
								live.current = void 0;
								setData(void 0);
								setUnread(0);
								setPublication(void 0);
							}
						}
					}
					if (!controller.signal.aborted) timer = window.setTimeout(() => void read(), open ? 1600 : 6e3);
				};
				read();
				return () => {
					controller.abort();
					if (timer !== void 0) window.clearTimeout(timer);
				};
			}, [open, cycle]);
			(0, react.useEffect)(() => () => older.current?.abort(), []);
			const loadOlder = async () => {
				const start = live.current;
				if (!start?.hasMore || start.nextBefore === null || older.current) return false;
				const controller = new AbortController();
				older.current = controller;
				setOlderError(void 0);
				setOlderBusy(true);
				try {
					const page = parseChat(await spiritRequest(`chat?before=${start.nextBefore}&limit=40`, void 0, controller.signal));
					const current = live.current;
					if (controller.signal.aborted || current?.mainId !== page.mainId) return false;
					const next = {
						...current,
						messages: mergeMessages(current.messages, page.messages),
						hasMore: page.hasMore,
						nextBefore: page.nextBefore
					};
					live.current = next;
					setData(next);
					return true;
				} catch (reason) {
					if (!controller.signal.aborted) setOlderError(messageOf(reason));
					return false;
				} finally {
					if (older.current === controller) older.current = void 0;
					if (!controller.signal.aborted) setOlderBusy(false);
				}
			};
			return {
				data,
				error,
				unread,
				refresh,
				acknowledge,
				loadOlder,
				olderBusy,
				olderError,
				publication
			};
		}
		function Icon({ name }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "18",
				height: "18",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.65",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: {
					arrow: "m14 6-6 6 6 6 M8 12h12",
					chevron: "m8 10 4 4 4-4",
					settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
					minus: "M5 12h14",
					send: "m21 3-7 18-3.5-7.5L3 10l18-7ZM10.5 13.5 21 3",
					model: "M8 3h8v4h4v10h-4v4H8v-4H4V7h4V3Zm1 7h6v4H9v-4Z",
					chat: "M20 11.5a7.8 7.8 0 0 1-8 7.5H5l1.8-2.6A7.14 7.14 0 0 1 4 11.5 7.8 7.8 0 0 1 12 4a7.8 7.8 0 0 1 8 7.5ZM9 12h.01m3 0h.01m3 0h.01",
					history: "M3 12a9 9 0 1 1 2.7 6.4M3 12V6m0 6h6m3-4v4l2.5 1.5"
				}[name] })
			});
		}
		function stamp(value, formatter) {
			const date = new Date(value);
			return Number.isFinite(+date) ? formatter.format(date) : "";
		}
		function fishActivity(presence) {
			const activity = presence?.activity;
			if (activity?.media?.kind === "video" && activity.media.state === "playing") return "video";
			if (activity?.media?.state === "observing") return "observing";
			switch (activity?.kind) {
				case "thinking":
				case "working": return "working";
				case "observing": return "observing";
				case "sleep": return "sleep";
				default: return "idle";
			}
		}
		function useWorkArea(launcher) {
			const [edges, setEdges] = (0, react.useState)({
				left: 0,
				right: 0
			});
			(0, react.useLayoutEffect)(() => {
				const root = launcher.current;
				const overlay = root?.closest("[data-shell-overlay]");
				const rightbar = overlay?.parentElement?.querySelector("[data-rightbar-col]");
				const center = rightbar?.previousElementSibling;
				if (!root || !overlay || !rightbar || !center) return;
				const update = () => {
					const frame = overlay.getBoundingClientRect(), work = center.getBoundingClientRect();
					const left = Math.max(0, Math.round(work.left - frame.left)), right = Math.max(0, Math.round(frame.right - work.right));
					setEdges((previous) => previous.left === left && previous.right === right ? previous : {
						left,
						right
					});
				};
				const viewport = window.visualViewport;
				const updateViewport = () => {
					if (!viewport || viewport.scale !== 1) return;
					root.style.setProperty("--jingshen-visible-height", `${viewport.height}px`);
					root.style.setProperty("--jingshen-keyboard-inset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
				};
				update();
				updateViewport();
				const observer = new ResizeObserver(update);
				observer.observe(overlay);
				observer.observe(center);
				viewport?.addEventListener("resize", updateViewport);
				viewport?.addEventListener("scroll", updateViewport);
				return () => {
					observer.disconnect();
					viewport?.removeEventListener("resize", updateViewport);
					viewport?.removeEventListener("scroll", updateViewport);
				};
			}, [launcher]);
			return edges;
		}
		function SpiritWindow({ hideLauncher, renderManagement, renderModels, renderNativeInteractions, openSource, saveBreezeKey, onMainId, openSignal }) {
			const [mode, setMode] = (0, react.useState)("closed");
			const [draft, setDraft] = (0, react.useState)("");
			const [sendError, setSendError] = (0, react.useState)();
			const [sending, setSending] = (0, react.useState)(false);
			const [call, setCall] = (0, react.useState)();
			const [mediaPanel, setMediaPanel] = (0, react.useState)();
			const [follow, setFollow] = (0, react.useState)(true);
			const [watching, setWatching] = (0, react.useState)(false);
			const [nativePending, setNativePending] = (0, react.useState)(0);
			const [gesture, setGesture] = (0, react.useState)();
			const usedGesture = (0, react.useRef)();
			const [sourceError, setSourceError] = (0, react.useState)("");
			const dispatch = (0, react.useRef)();
			const pending = (0, react.useRef)(false);
			const lifetime = (0, react.useRef)();
			const root = (0, react.useRef)(null);
			const dialogTitle = (0, react.useRef)(null);
			const launcher = (0, react.useRef)(null);
			const transcript = (0, react.useRef)(null);
			const phoneEntry = (0, react.useRef)(null);
			const focusPhoneEntry = (0, react.useRef)(false);
			const focusLauncher = (0, react.useRef)(false);
			const receivedOpen = (0, react.useRef)(openSignal);
			const olderHeight = (0, react.useRef)();
			const id = (0, react.useId)();
			const showing = mode !== "closed";
			const chat = useSpiritChat(showing);
			const { data, error, unread, acknowledge, refresh, publication } = chat;
			const notifications = [...unread ? [`${unread} 条未读`] : [], ...nativePending ? [`${nativePending} 项需要处理`] : []];
			const { left, right } = useWorkArea(root);
			const kind = data?.presence.activity.kind;
			const paused = kind === "paused" || kind === "stopped";
			const canSend = !!data && !error && !paused;
			const media = data?.presence.activity.media;
			const watchingVideo = watching || media?.kind === "video" && media.state === "playing";
			const status = error ? isAuthorized(error) ? "连接中断" : "需要授权" : watchingVideo && !paused ? "在看视频" : kind ? activityLabels[kind] : "正在连接";
			const detail = data?.presence.activity.label;
			const activity = watchingVideo && !paused ? "video" : fishActivity(data?.presence);
			const expression = data?.presence.expression;
			const isPhone = mode === "phone";
			const callInProgress = call?.phase === "connecting" || call?.connected === true;
			const onCall = isPhone && call?.connected === true && !paused;
			const currentMood = expression && Date.parse(expression.until) > Date.now() ? expressionMoods[expression.kind] : void 0;
			const mood = !isPhone && gesture ? gesture.mood : currentMood;
			const showChat = mode === "chat" && !isPhone;
			const lastCursor = data?.cursor;
			(0, react.useEffect)(() => {
				lifetime.current = new AbortController();
				return () => lifetime.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (!publication || usedGesture.current === publication || isPhone) {
					if (isPhone || !publication) {
						usedGesture.current = publication;
						setGesture(void 0);
					}
					return;
				}
				usedGesture.current = publication;
				setGesture(publication);
				const timeout = window.setTimeout(() => setGesture(void 0), publication.duration);
				return () => window.clearTimeout(timeout);
			}, [publication, isPhone]);
			(0, react.useEffect)(() => {
				if (data?.mainId) onMainId?.(data.mainId);
			}, [data?.mainId, onMainId]);
			(0, react.useEffect)(() => {
				if (receivedOpen.current !== openSignal) {
					receivedOpen.current = openSignal;
					setFollow(true);
					setMode("chat");
					setMediaPanel(void 0);
					setCall(void 0);
				}
			}, [openSignal]);
			(0, react.useEffect)(() => {
				if (mode === "chat" && focusPhoneEntry.current) {
					focusPhoneEntry.current = false;
					phoneEntry.current?.focus({ preventScroll: true });
				} else if (mode === "closed") {
					if (focusLauncher.current) launcher.current?.focus({ preventScroll: true });
					focusLauncher.current = false;
				} else dialogTitle.current?.focus({ preventScroll: true });
			}, [mode]);
			(0, react.useEffect)(() => {
				if (showChat && follow && !document.hidden) acknowledge();
			}, [
				showChat,
				follow,
				lastCursor,
				acknowledge
			]);
			(0, react.useEffect)(() => {
				const onVisible = () => {
					if (showChat && follow && !document.hidden) acknowledge();
				};
				document.addEventListener("visibilitychange", onVisible);
				return () => document.removeEventListener("visibilitychange", onVisible);
			}, [
				showChat,
				follow,
				acknowledge
			]);
			(0, react.useLayoutEffect)(() => {
				const list = transcript.current;
				if (!list) return;
				if (olderHeight.current) {
					const { top, height } = olderHeight.current;
					olderHeight.current = void 0;
					list.scrollTop = list.scrollHeight - height + top;
				} else if (showChat && follow) list.scrollTop = list.scrollHeight;
			}, [
				showChat,
				follow,
				data?.messages
			]);
			const close = () => {
				focusLauncher.current = true;
				setMode("closed");
				setCall(void 0);
				setMediaPanel(void 0);
			};
			const reveal = () => {
				setFollow(true);
				setMode("chat");
			};
			const returnToChat = () => {
				if (isPhone) {
					setCall(void 0);
					focusPhoneEntry.current = true;
				}
				setMediaPanel(void 0);
				setMode("chat");
			};
			const toggleMedia = (panel) => setMediaPanel((current) => current === panel ? void 0 : panel);
			const leaveForSession = async (sessionId) => {
				if (sessionId === data?.mainId) {
					reveal();
					return;
				}
				await openSource(sessionId);
				close();
			};
			const visitSource = async (sessionId) => {
				setSourceError("");
				try {
					await leaveForSession(sessionId);
				} catch (reason) {
					setSourceError(messageOf(reason));
				}
			};
			const attemptSend = async () => {
				const text = draft.trim();
				if (!text || !canSend || pending.current) return;
				if (dispatch.current?.text !== text) dispatch.current = {
					requestId: crypto.randomUUID(),
					text
				};
				pending.current = true;
				setSending(true);
				setSendError(void 0);
				try {
					if (!(await spiritRequest("chat", dispatch.current, lifetime.current?.signal)).accepted) throw new Error("宿主尚未接收这条消息。");
					setDraft((current) => current.trim() === text ? "" : current);
					dispatch.current = void 0;
					setFollow(true);
					refresh();
				} catch (reason) {
					if (!lifetime.current?.signal.aborted) setSendError(messageOf(reason));
				} finally {
					pending.current = false;
					if (!lifetime.current?.signal.aborted) setSending(false);
				}
			};
			const key = (event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				if (mediaPanel) {
					const toggle = event.currentTarget.querySelector(`button[aria-controls="${id}-${mediaPanel}"]`);
					setMediaPanel(void 0);
					toggle?.focus({ preventScroll: true });
				} else if (mode !== "chat") returnToChat();
				else close();
			};
			const earlier = async () => {
				const list = transcript.current;
				if (list) olderHeight.current = {
					top: list.scrollTop,
					height: list.scrollHeight
				};
				setFollow(false);
				if (!await chat.loadOlder()) olderHeight.current = void 0;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "jingshen-dock",
				ref: root,
				"data-active-call": isPhone || void 0,
				style: {
					"--jingshen-work-left": `${left}px`,
					"--jingshen-work-right": `${right}px`
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("style", { children: [spirit_ui_default, fishCss] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						ref: launcher,
						className: "jingshen-launcher",
						hidden: hideLauncher,
						"aria-label": showing ? "缩小精神通讯" : ["打开精神通讯", ...notifications].join("，"),
						title: detail || status,
						"aria-expanded": showing,
						"aria-controls": showing ? id : void 0,
						tabIndex: showing ? -1 : 0,
						onClick: showing ? close : reveal,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpiritFish, {
								activity,
								mood: mood ?? null,
								speaking: isPhone ? call?.speaking : !!gesture,
								onCall
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "jingshen-launcher-marker",
								"data-status": error ? "error" : kind,
								"aria-hidden": "true",
								children: unread && !showing ? Math.min(unread, 99) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
							}),
							!showing && nativePending > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "jingshen-approval-marker",
								"aria-hidden": "true",
								children: "!"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						id,
						role: "dialog",
						hidden: !showing,
						"aria-labelledby": `${id}-title`,
						className: "jingshen-window",
						"data-view": mode,
						"data-phone": isPhone || void 0,
						onKeyDown: key,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: "jingshen-header",
								children: [
									mode !== "chat" && mode !== "closed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "jingshen-icon",
										"aria-label": "返回通讯",
										title: "返回通讯",
										onClick: returnToChat,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "arrow" })
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "jingshen-header-avatar",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpiritFish, {
											variant: "portrait",
											activity,
											mood: mood ?? null
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "jingshen-header-text",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
											ref: dialogTitle,
											id: `${id}-title`,
											tabIndex: -1,
											children: isPhone ? "语音通话" : mode === "manage" ? "管理精神" : mode === "model" ? "会话模型" : "精神"
										}), !isPhone && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "jingshen-status",
											"data-state": kind,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { "aria-hidden": "true" }),
												status,
												mode === "chat" && detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
													title: detail,
													children: detail
												})
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "jingshen-header-actions",
										children: [
											nativePending > 0 && mode !== "chat" && !isPhone && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "jingshen-pending-link",
												"aria-label": "返回通讯查看待处理请求",
												onClick: reveal,
												children: [nativePending, " 项待处理"]
											}),
											mode === "chat" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													ref: phoneEntry,
													className: "jingshen-icon",
													title: "语音通话",
													"aria-label": "语音通话",
													disabled: !data || !!error || paused,
													onClick: () => {
														setMediaPanel(void 0);
														setMode("phone");
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MediaIcon, { name: "phone" })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "jingshen-icon",
													title: "选择主会话模型",
													"aria-label": "选择主会话模型",
													disabled: !data || !!error,
													onClick: () => {
														setMediaPanel(void 0);
														setMode("model");
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "model" })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "jingshen-icon",
													title: "管理精神",
													"aria-label": "管理精神",
													onClick: () => {
														setMediaPanel(void 0);
														setMode("manage");
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "settings" })
												})
											] }),
											data && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisionControls, {
												paused: paused || !isAuthorized(error),
												inPhone: isPhone,
												callInProgress,
												open: mediaPanel === "vision",
												panelId: `${id}-vision`,
												onToggle: () => toggleMedia("vision"),
												onWatchingChange: setWatching
											}),
											isPhone && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "jingshen-icon",
												title: "语音选项",
												"aria-label": "语音选项",
												"aria-expanded": mediaPanel === "voice",
												"aria-controls": `${id}-voice`,
												onClick: () => toggleMedia("voice"),
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "settings" })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "jingshen-icon",
												title: "缩小窗口",
												"aria-label": "缩小窗口",
												onClick: close,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "minus" })
											})
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "jingshen-window-main",
								children: isPhone ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "jingshen-call-scene",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "jingshen-call-orbit",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpiritFish, {
											activity: watchingVideo ? "video" : "idle",
											mood: mood ?? null,
											onCall,
											speaking: call?.speaking
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VoiceCall, {
										active: !!data && !paused && !error,
										optionsOpen: mediaPanel === "voice",
										optionsId: `${id}-voice`,
										onCallChange: setCall,
										saveBreezeKey
									})]
								}) : mode === "manage" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "jingshen-management",
									children: renderManagement(leaveForSession)
								}) : mode === "model" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "jingshen-model-view",
									children: data ? renderModels(data.mainId) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "连接到主会话后可选择模型。" })
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "jingshen-transcript",
									ref: transcript,
									role: "region",
									"aria-label": "通讯记录",
									tabIndex: 0,
									onScroll: (event) => {
										const node = event.currentTarget;
										setFollow(node.scrollHeight - node.clientHeight - node.scrollTop < 44);
									},
									children: [
										data?.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "jingshen-history",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												disabled: chat.olderBusy,
												onClick: () => void earlier(),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "history" }), chat.olderBusy ? "正在读取" : "查看更早消息"]
											}), chat.olderError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												role: "alert",
												children: chat.olderError
											})]
										}),
										!data?.messages.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "jingshen-empty",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "jingshen-empty-icon",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "chat" })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error ? isAuthorized(error) ? "无法读取通讯记录" : "此窗口尚未获得授权" : data ? "这里是你和精神的主会话" : "正在连接精神" }),
												data && !error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "发一条消息，继续今天的事。" })
											]
										}),
										data?.messages.map((row, index) => {
											const date = stamp(row.at, dateFormatter);
											const showDate = date && (index === 0 || date !== stamp(data.messages[index - 1].at, dateFormatter));
											const otherSession = row.source.sessionId !== data.mainId;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [showDate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "jingshen-date",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: date })
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
												className: "jingshen-message",
												"data-author": row.author,
												"data-message-id": row.id,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "jingshen-bubble",
													children: row.text
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "jingshen-message-meta",
													children: [otherSession && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														onClick: () => void visitSource(row.source.sessionId),
														children: [
															row.source.title || "查看来源会话",
															" ",
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																"aria-hidden": "true",
																children: "↗"
															})
														]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
														dateTime: row.at,
														children: stamp(row.at, timeFormatter)
													})]
												})]
											})] }, row.id);
										})
									]
								}), !follow && unread > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "jingshen-jump",
									onClick: () => setFollow(true),
									children: [
										unread,
										" 条新消息 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "chevron" })
									]
								})] })
							}),
							data && renderNativeInteractions && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "jingshen-native-interactions",
								hidden: mode === "manage" || mode === "model",
								children: renderNativeInteractions(data.mainId, setNativePending)
							}),
							sourceError && showChat && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "jingshen-notice",
								role: "alert",
								children: sourceError
							}),
							error && mode === "chat" && !isPhone && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "jingshen-notice",
								role: "alert",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: isAuthorized(error) ? error.message : "请在已连接的本机 Harness 中重新打开此窗口。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: refresh,
									children: "重试"
								})]
							}),
							showChat && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", {
								className: "jingshen-footer",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
									className: "jingshen-compose",
									onSubmit: (event) => {
										event.preventDefault();
										attemptSend();
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "jingshen-compose-box",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											rows: 1,
											"aria-label": "给精神发消息",
											value: draft,
											maxLength: 8e3,
											disabled: !canSend,
											placeholder: paused ? "恢复活动后发送消息" : "发消息给精神",
											onChange: (event) => {
												setDraft(event.target.value);
												setSendError(void 0);
											},
											onKeyDown: (event) => {
												if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
												event.preventDefault();
												attemptSend();
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "submit",
											className: "jingshen-send",
											"aria-label": "发送消息",
											title: "发送消息",
											disabled: !canSend || !draft.trim() || sending,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, { name: "send" })
										})]
									}), sendError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										role: "alert",
										children: sendError
									})]
								})
							})
						]
					})
				]
			});
		}
		// src/native-mediation-badges.ts
		const rowSelector = "[data-chat-flow-kind=\"assistant-step\"]:not([data-chat-group-part=\"reasoning\"])";
		const surfaceSelector = "[data-conversation-session]";
		const messageAt = (snapshot, row) => {
			const key = row.dataset.chatNodeKey;
			const node = key ? snapshot?.nodes.get(key) : void 0;
			return node?.kind === "assistant-step" && node.data?.status === "settled" ? node.data.finalNode?.messageId : void 0;
		};
		function observeMediationBadges(conversations, mainId) {
			const sessions = /* @__PURE__ */ new Map();
			const annotations = /* @__PURE__ */ new Map();
			let frame;
			const remove = (row, annotation) => {
				annotation.abort.abort();
				clearTimeout(annotation.retry);
				annotation.badge?.remove();
				annotations.delete(row);
			};
			const attach = (row, sessionId, messageId) => {
				const current = annotations.get(row);
				if (current?.sessionId === sessionId && current.messageId === messageId) {
					if (current.badge && current.badge.parentElement !== row) row.append(current.badge);
					return;
				}
				if (current) remove(row, current);
				const annotation = {
					sessionId,
					messageId,
					abort: new AbortController()
				};
				annotations.set(row, annotation);
				const query = new URLSearchParams({
					sessionId,
					messageId
				});
				const currentRow = () => !annotation.abort.signal.aborted && row.isConnected && row.matches(rowSelector) && row.closest(surfaceSelector)?.dataset.conversationSession === sessionId && messageAt(sessions.get(sessionId)?.binding.target("chat").getSnapshot(), row) === messageId;
				const lookup = async (retryDelay) => {
					if (!currentRow()) return;
					try {
						const result = await spiritRequest(`mediation?${query}`, void 0, annotation.abort.signal);
						if (!Array.isArray(result?.records)) throw new Error("无法读取交付回执");
						if (!currentRow() || !result.records.some((record) => record?.sessionId === sessionId && record.messageId === messageId && record.source === "spirit" && (record.disposition === "speak" || record.disposition === "continue"))) return;
						const badge = document.createElement("span");
						badge.className = "jingshen-mediation-badge";
						badge.dataset.messageId = messageId;
						badge.title = "这条答复经过精神中介后交付";
						badge.textContent = "精神";
						annotation.badge = badge;
						row.append(badge);
					} catch {
						if (currentRow()) annotation.retry = setTimeout(() => {
							lookup(Math.min(3e4, retryDelay * 2));
						}, retryDelay);
					}
				};
				lookup(1e3);
			};
			const sync = () => {
				frame = void 0;
				const visibleSessions = /* @__PURE__ */ new Set(), visibleRows = /* @__PURE__ */ new Set();
				for (const surface of document.querySelectorAll(surfaceSelector)) {
					const sessionId = surface.dataset.conversationSession;
					if (!sessionId || sessionId === mainId) continue;
					visibleSessions.add(sessionId);
					let session = sessions.get(sessionId);
					if (!session) try {
						const binding = conversations.binding(sessionId);
						session = {
							binding,
							unsubscribe: binding.snapshot.subscribe(schedule)
						};
						sessions.set(sessionId, session);
					} catch {
						continue;
					}
					const snapshot = session.binding.target("chat").getSnapshot();
					for (const row of surface.querySelectorAll(rowSelector)) {
						if (row.closest(surfaceSelector) !== surface) continue;
						const messageId = messageAt(snapshot, row);
						if (!messageId) continue;
						visibleRows.add(row);
						attach(row, sessionId, messageId);
					}
				}
				for (const [row, annotation] of annotations) if (!visibleRows.has(row)) remove(row, annotation);
				for (const [id, session] of sessions) if (!visibleSessions.has(id)) {
					session.unsubscribe();
					sessions.delete(id);
				}
			};
			const schedule = () => {
				frame ??= requestAnimationFrame(sync);
			};
			const observer = new MutationObserver(schedule);
			observer.observe(document.body, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: [
					"data-conversation-session",
					"data-chat-flow-kind",
					"data-chat-node-key",
					"data-chat-group-part"
				]
			});
			schedule();
			return () => {
				observer.disconnect();
				if (frame !== void 0) cancelAnimationFrame(frame);
				for (const session of sessions.values()) session.unsubscribe();
				for (const [row, annotation] of annotations) remove(row, annotation);
			};
		}
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
		function Panel({ openSession, embedded = false }) {
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
			const shownSessions = embedded ? state?.sessions?.filter((item) => item.id !== state.mainId) : state?.sessions;
			const count = state ? {
				sessions: shownSessions?.length,
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
							children: [!embedded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "精神" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "spirit-muted",
								children: "会话、正在做的事，以及留下的经验。"
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "spirit-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: !state || busy,
									onClick: () => void exportData(),
									children: "导出记录"
								}), !embedded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
												children: "其他会话可从记录中的来源打开，主会话的待确认请求在通讯窗处理。"
											}),
											!shownSessions?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "spirit-empty-inline",
												children: shownSessions ? "当前没有已登记的会话。" : "会话列表尚未同步。"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "spirit-session-list",
												children: shownSessions?.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
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
		function modelCatalog(ctx) {
			return ctx.remote.session.modelCatalog();
		}
		const modelKey = (provider, model) => JSON.stringify([provider, model]);
		function SpiritModels({ ctx }) {
			const [catalog, setCatalog] = (0, react.useState)();
			const [current, setCurrent] = (0, react.useState)();
			const [draft, setDraft] = (0, react.useState)();
			const [error, setError] = (0, react.useState)("");
			const [saved, setSaved] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const [reload, setReload] = (0, react.useState)(0);
			const selection = draft ?? current ?? catalog?.default;
			const option = catalog?.groups.find((group) => group.id === selection?.provider)?.models.find((model) => model.id === selection?.model);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setError("");
				Promise.all([Promise.resolve().then(() => modelCatalog(ctx)), spiritRequest("model", void 0, controller.signal)]).then(([catalogResult, selectionResult]) => {
					if (controller.signal.aborted) return;
					if (!catalogResult.ok) throw new Error(catalogResult.error.message);
					setCatalog(catalogResult.value);
					setCurrent(selectionResult.selected ?? void 0);
				}).catch((reason) => {
					if (!controller.signal.aborted) setError(message(reason));
				});
				return () => controller.abort();
			}, [ctx, reload]);
			const apply = async () => {
				if (!draft || saving) return;
				setSaving(true);
				setSaved("");
				setError("");
				try {
					const result = await spiritRequest("model", draft);
					if (!result.selected) throw new Error("宿主尚未确认模型选择。");
					setCurrent(result.selected);
					setDraft(void 0);
					setSaved("已更新主会话模型。");
				} catch (reason) {
					setError(message(reason));
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: "jingshen-model-form",
				onSubmit: (event) => {
					event.preventDefault();
					apply();
				},
				children: [
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					}),
					saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: saved
					}),
					!catalog ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [!error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: "正在读取 Harness 的模型目录…"
					}), error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setReload((value) => value + 1),
						children: "重新读取模型"
					})] }) : catalog.groups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前没有可用模型。请先在 Harness 的模型或账户设置中配置。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setReload((value) => value + 1),
						children: "重新读取模型"
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["模型", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							"aria-label": "模型",
							value: selection ? modelKey(selection.provider, selection.model) : "",
							disabled: saving,
							onChange: (event) => {
								const [provider, model] = JSON.parse(event.target.value);
								setDraft({
									provider,
									model
								});
								setSaved("");
							},
							children: [selection && !option && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: modelKey(selection.provider, selection.model),
								disabled: true,
								children: [selection.model, "（当前不可用）"]
							}), catalog.groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
								label: group.name,
								children: group.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: modelKey(group.id, model.id),
									children: model.name
								}, model.id))
							}, group.id))]
						})] }),
						selection && !!option?.reasoning?.efforts.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["推理等级", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							"aria-label": "推理等级",
							value: selection.reasoningEffort ?? "",
							disabled: saving,
							onChange: (event) => {
								setDraft({
									provider: selection.provider,
									model: selection.model,
									...event.target.value ? { reasoningEffort: event.target.value } : {}
								});
								setSaved("");
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "模型默认"
							}), option.reasoning.efforts.map((effort) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: effort.id,
								children: effort.name
							}, effort.id))]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: saving || !draft || !option,
							children: saving ? "正在应用…" : "应用模型"
						})
					] })
				]
			});
		}
		const privateMainPanel = "dsh-jingshen.private-main";
		const privateIdentityStorage = "dsh-jingshen.main-session";
		function cachedMainId() {
			try {
				return sessionStorage.getItem(privateIdentityStorage) ?? void 0;
			} catch {
				return;
			}
		}
		function SpiritOverlay({ ctx, useWorkspaces }) {
			const [mainId, setMainId] = (0, react.useState)(cachedMainId);
			const panels = ctx.layout.panelInfo;
			const subscribePanel = (0, react.useCallback)((listener) => panels.subscribe(listener), [panels]);
			const inPluginManager = (0, react.useCallback)(() => panels.getSnapshot().activePanelId === "plugins", [panels]);
			const hideLauncher = (0, react.useSyncExternalStore)(subscribePanel, inPluginManager, inPluginManager);
			(0, react.useEffect)(() => {
				if (!mainId) return;
				const fiber = ctx.inject(["uiConversation"], (active) => {
					const conversations = active.get("uiConversation");
					active.effect(() => observeMediationBadges(conversations, mainId));
				});
				return () => {
					fiber.dispose();
				};
			}, [ctx, mainId]);
			const credentials = ctx.get?.("remote.credentials");
			const saveBreezeKey = async (value) => {
				if (!(await credentials?.set("BREEZE_API_KEY", value))?.ok) throw new Error("Harness 未保存 Breeze 密钥");
			};
			const acceptMainId = (0, react.useCallback)((id) => {
				try {
					sessionStorage.setItem(privateIdentityStorage, id);
				} catch {}
				setMainId(id);
			}, []);
			const [openSignal, setOpenSignal] = (0, react.useState)(0);
			const workspaces = useWorkspaces((snapshot) => snapshot.items);
			const subscribeSessions = (0, react.useCallback)((listener) => ctx.sessions.list.subscribe(listener), [ctx]);
			const mainPath = (0, react.useCallback)(() => mainId ? ctx.sessions.list.getSnapshot().byId[mainId]?.cwd : void 0, [ctx, mainId]);
			const privatePath = (0, react.useSyncExternalStore)(subscribeSessions, mainPath, mainPath);
			const hasUngrouped = (0, react.useCallback)(() => ctx.sessions.list.getSnapshot().ids.some((id) => id !== mainId && !workspaces.some((workspace) => workspace.sessionIds.includes(id))), [
				ctx,
				mainId,
				workspaces
			]);
			const showUngrouped = (0, react.useSyncExternalStore)(subscribeSessions, hasUngrouped, hasUngrouped);
			const hiddenWorkspaces = privatePath ? workspaces.filter((item) => item.path === privatePath && item.sessionIds.every((sessionId) => sessionId === mainId)) : [];
			(0, react.useLayoutEffect)(() => {
				if (!mainId) return;
				const references = ctx.sessions.retainInfo(mainId);
				let stopped = false;
				let queued = false;
				const reconcile = () => {
					queued = false;
					if (stopped) return;
					const active = panels.getSnapshot().activePanelId;
					const nativeView = !!references.getSnapshot().retainedBy.mainView;
					if (nativeView && active === null) {
						ctx.layout.selectPanel(privateMainPanel);
						setOpenSignal((value) => value + 1);
					} else if (!nativeView && active === privateMainPanel) ctx.layout.selectPanel(null);
				};
				const schedule = () => {
					if (!queued) {
						queued = true;
						queueMicrotask(reconcile);
					}
				};
				const disposeReferences = references.subscribe(schedule);
				const disposePanels = panels.subscribe(schedule);
				schedule();
				return () => {
					stopped = true;
					disposeReferences();
					disposePanels();
				};
			}, [
				ctx,
				mainId,
				panels
			]);
			const openSession = async (id) => {
				const target = id;
				if (ctx.sessions.list.getSnapshot().phase !== "ready" || !ctx.sessions.list.getSnapshot().byId[target]) await ctx.sessions.refresh();
				const list = ctx.sessions.list.getSnapshot();
				if (list.phase !== "ready") throw new Error("会话列表尚未就绪，请稍后重试。");
				if (!list.byId[target]) throw new Error("未在 Harness 中找到这个会话，请刷新后重试。");
				ctx.uiWorkspace.openSession(target);
			};
			const hidden = mainId && [
				`[data-row-key="${CSS.escape(`session:${mainId}`)}"]`,
				...!showUngrouped ? ["[data-row-key=\"workspace:\"]"] : [],
				...hiddenWorkspaces.map((item) => `[data-row-key="${CSS.escape(`workspace:${item.workspaceId}`)}"]`),
				`[data-phase]:has(> [data-conversation-session="${CSS.escape(mainId)}"])`
			].join(",");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [hidden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `${hidden}{display:none!important}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpiritWindow, {
				hideLauncher,
				renderManagement: (openNative) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Panel, {
					embedded: true,
					openSession: openNative
				}),
				renderModels: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpiritModels, { ctx }),
				saveBreezeKey: credentials?.set ? saveBreezeKey : void 0,
				renderNativeInteractions: (sessionId, onPendingChange) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeInteractions, {
					ctx,
					sessionId,
					onPendingChange
				}),
				openSource: openSession,
				onMainId: acceptMainId,
				openSignal
			})] });
		}
		const inject = [
			"slots",
			"sessions",
			"layout",
			"uiWorkspace",
			"uiSession",
			"remote",
			"remote.session"
		];
		function apply(ctx) {
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: privateMainPanel
			}, () => null));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-jingshen"
			}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpiritOverlay, {
				...props,
				ctx
			})));
		}
		exports.Panel = Panel;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
