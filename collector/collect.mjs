import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
//#region src/env.ts
var sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE feeds(id TEXT PRIMARY KEY,payload TEXT,saved_at INTEGER,next_due INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,error TEXT,scope TEXT NOT NULL DEFAULT '');
CREATE TABLE api_usage(id TEXT PRIMARY KEY,calls INTEGER NOT NULL DEFAULT 0);
CREATE TABLE collection_state(id TEXT PRIMARY KEY,next_due INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,last_started INTEGER,last_finished INTEGER,last_error TEXT);
CREATE TABLE warning_snapshot(id TEXT PRIMARY KEY,payload TEXT,saved_at INTEGER);
CREATE TABLE api_cache(cache_key TEXT PRIMARY KEY,payload TEXT,expires_at INTEGER);`);
var tables = [
	"feeds",
	"api_usage",
	"collection_state",
	"warning_snapshot",
	"api_cache"
];
var DB = {
	prepare(sql) {
		let values = [];
		const q = {
			bind(...v) {
				values = v;
				return q;
			},
			async first() {
				return sqlite.prepare(sql).get(...values) ?? null;
			},
			async all() {
				return { results: sqlite.prepare(sql).all(...values) };
			},
			async run() {
				const r = sqlite.prepare(sql).run(...values);
				return { meta: { changes: Number(r.changes) } };
			}
		};
		return q;
	},
	async batch(items) {
		return Promise.all(items);
	}
};
var env = {
	...process.env,
	DB
};
function hydrate(state) {
	if (state === void 0) return;
	if (state?.version !== 1) throw Error("수집 상태 버전 확인 필요");
	for (const table of tables) {
		const rows = state[table] ?? [];
		if (!Array.isArray(rows)) throw Error("수집 상태 형식 확인 필요");
		for (const row of rows) {
			const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name);
			const names = Object.keys(row);
			if (names.some((n) => !columns.includes(n))) throw Error("수집 상태 필드 확인 필요");
			sqlite.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...names.map((n) => row[n]));
		}
	}
}
function dump() {
	sqlite.prepare("DELETE FROM api_cache WHERE expires_at<=?").run(Date.now());
	const cutoff = (/* @__PURE__ */ new Date(Date.now() - 8 * 864e5)).toISOString().slice(0, 10);
	sqlite.prepare("DELETE FROM api_usage WHERE substr(id,-10)<?").run(cutoff);
	return {
		version: 1,
		...Object.fromEntries(tables.map((t) => [t, sqlite.prepare(`SELECT * FROM ${t}`).all()]))
	};
}
//#endregion
//#region src/model.ts
var CITIES = [
	"수원시",
	"성남시",
	"의정부시",
	"안양시",
	"부천시",
	"광명시",
	"평택시",
	"동두천시",
	"안산시",
	"고양시",
	"과천시",
	"구리시",
	"남양주시",
	"오산시",
	"시흥시",
	"군포시",
	"의왕시",
	"하남시",
	"용인시",
	"파주시",
	"이천시",
	"안성시",
	"김포시",
	"화성시",
	"광주시",
	"양주시",
	"포천시",
	"여주시",
	"연천군",
	"가평군",
	"양평군"
];
var FEEDS = [
	{
		id: "messages",
		name: "긴급재난문자",
		path: "DSSP-IF-00247",
		key: "SAFETYDATA_MESSAGES_KEY"
	},
	{
		id: "water",
		name: "하천수위 · 10분 자료",
		path: "DSSP-IF-00007",
		key: "SAFETYDATA_WATER_KEY"
	},
	{
		id: "rain",
		name: "우량 · 시간 자료",
		path: "DSSP-IF-00005",
		key: "SAFETYDATA_RAIN_KEY"
	},
	{
		id: "fire",
		name: "산불 발생정보",
		path: "DSSP-IF-10346",
		key: "SAFETYDATA_FIRE_KEY"
	},
	{
		id: "landslide",
		name: "산사태 공식 발령",
		path: "DSSP-IF-00734",
		key: "SAFETYDATA_LANDSLIDE_KEY"
	},
	{
		id: "prediction",
		name: "산사태 공식 예측",
		path: "DSSP-IF-00735",
		key: "SAFETYDATA_PREDICTION_KEY"
	},
	{
		id: "pop",
		name: "강수확률 예보",
		path: "DSSP-IF-00029",
		key: "SAFETYDATA_POP_KEY"
	},
	{
		id: "rain6",
		name: "6시간 강수량 예보",
		path: "DSSP-IF-00031",
		key: "SAFETYDATA_RAIN6_KEY"
	}
];
var kstDay = (at = Date.now()) => new Date(Number(at) + 9 * 36e5).toISOString().slice(0, 10);
function dateValue(v) {
	const s = String(v ?? "").trim();
	if (!s) return null;
	let t = s;
	if (/^\d{14}$/.test(s)) t = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12)}+09:00`;
	else if (/^\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}/.test(s)) t = s.replace(/[/.]/g, "-").replace(" ", "T") + (/[zZ]$|[+-]\d\d:\d\d$/.test(s) ? "" : "+09:00");
	return Number.isFinite(Date.parse(t)) ? new Date(t).toISOString() : null;
}
function field(row, ...keys) {
	for (const key of keys) {
		const value = row[key];
		if (value !== null && value !== void 0 && String(value).trim()) return String(value);
	}
	return "";
}
function targetCities(area) {
	if (/전국|경기도\s*(전체|전역)/.test(area) || area.trim() === "경기도") return [...CITIES];
	return CITIES.filter((c) => area.includes(c) && !(c === "광주시" && !area.includes("경기도 광주시") && /광주광역시/.test(area)));
}
function parseMessages(rows) {
	return rows.map((row) => {
		const text = field(row, "MSG_CN", "msg_cn", "msgCn", "MESSAGE", "msg");
		const area = field(row, "RCPTN_RGN_NM", "rcptn_rgn_nm", "rcptnRgnNm", "LOCATION_NAME");
		const at = dateValue(field(row, "CRT_DT", "crt_dt", "crtDt", "CREATE_DATE"));
		if (!text || !area || !at) return null;
		return {
			id: field(row, "SN", "sn", "MD101_SN") || `${at}:${area}:${text}`,
			at,
			area,
			text,
			kind: field(row, "DST_SE_NM", "dst_se_nm", "dstSeNm"),
			level: field(row, "EMRG_STEP_NM", "emrg_step_nm", "emrgStepNm"),
			cities: targetCities(area)
		};
	}).filter((x) => x !== null);
}
function decodeResponse(json) {
	const root = json.response ?? json;
	const head = root.header ?? {};
	const code = head.resultCode ?? head.result_code;
	if (code !== void 0 && ![
		"00",
		"0",
		"200",
		"INFO-000",
		"NORMAL_SERVICE"
	].includes(String(code))) throw Error(`제공기관 응답 ${String(code).slice(0, 24)}`);
	if (root.error) throw Error("제공기관 오류 응답");
	const body = root.body ?? root;
	const candidate = Array.isArray(body) ? body : body.items?.item ?? body.items ?? body.data ?? body.list ?? body.rows ?? root.data;
	const rows = Array.isArray(candidate) ? candidate : candidate && typeof candidate === "object" ? [candidate] : [];
	if (!candidate && Number(body.totalCount ?? root.totalCount) !== 0) throw Error("제공자료 형식 확인 필요");
	return {
		rows,
		total: Number(body.totalCount ?? root.totalCount ?? rows.length)
	};
}
function fresh(at, minutes, now = Date.now()) {
	const n = Date.parse(at ?? "");
	return Number.isFinite(n) && n <= now + 3e5 && now - n < minutes * 6e4;
}
//#endregion
//#region src/feed-health.ts
var TIME_FIELDS = {
	water: ["YMD_HM"],
	rain: ["YMD_HUR"],
	fire: ["FRSTFR_GNT_DT"],
	landslide: ["FRCST_APNT_DT"],
	prediction: ["PREDC_ANLS_DT"],
	pop: ["DT_TM_FC"],
	rain6: ["PRSNTN_TM"]
};
function feedTimestamp(id, row) {
	const raw = field(row, ...TIME_FIELDS[id] ?? []);
	const compact = raw.replace(/\D/g, "");
	if (/^\d{10}$/.test(raw)) return dateValue(compact + "0000");
	if (/^\d{12}$/.test(raw)) return dateValue(compact + "00");
	const parts = raw.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
	if (parts) return dateValue(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6] ?? "00"}+09:00`);
	return dateValue(raw);
}
function feedHealth(feed, now = Date.now()) {
	if (!feed) return {
		latestAt: null,
		currentRows: [],
		state: "연결 확인 중"
	};
	const dated = (feed.rows ?? []).map((row) => ({
		row,
		at: feedTimestamp(feed.id, row)
	})).filter((x) => x.at && Date.parse(x.at) <= now + 3e5).sort((a, b) => b.at.localeCompare(a.at));
	const latestAt = dated[0]?.at ?? null;
	const age = feed.id === "pop" || feed.id === "rain6" ? 720 : feed.id === "fire" || feed.id === "landslide" ? 1440 : 120;
	const currentRows = dated.filter((x) => fresh(x.at, age, now)).map((x) => x.row);
	return {
		latestAt,
		currentRows,
		state: feed.error ? "수신 지연" : !feed.savedAt ? feed.state : !feed.rows?.length ? "조회자료 없음" : !latestAt ? "자료시각 확인 중" : !currentRows.length ? "최신자료 미수신" : feed.complete ? "자료 수신" : "일부 자료 수신"
	};
}
function publicRows(id, rows) {
	if (id !== "fire") return rows;
	const allowed = [
		"FRSTFR_INFO_ID",
		"FRSTFR_GNT_DT",
		"FRSTFR_DCLR_ADDR",
		"FRSTFR_GNT_PLC",
		"EXTNGS_CMPTN_DT",
		"EXTNGS_END_DT",
		"FTRXTNGSH_SRNC_END_DT",
		"STDG_CTPV_CD",
		"STDG_SGG_CD"
	];
	return rows.map((row) => Object.fromEntries(allowed.filter((k) => k in row).map((k) => [k, row[k]])));
}
//#endregion
//#region src/water-stations.ts
var WATER_STATIONS = [
	{
		code: "1018665",
		city: "의정부시",
		name: "신곡교",
		river: "중랑천"
	},
	{
		code: "1023670",
		city: "파주시",
		name: "통일대교",
		river: "임진강"
	},
	{
		code: "1101610",
		city: "안성시",
		name: "안성교",
		river: "안성천"
	},
	{
		code: "1101620",
		city: "안성시",
		name: "공도",
		river: "안성천"
	},
	{
		code: "1101635",
		city: "평택시",
		name: "군문교",
		river: "안성천"
	},
	{
		code: "1101645",
		city: "오산시",
		name: "탑동대교",
		river: "오산천"
	},
	{
		code: "1101650",
		city: "화성시",
		name: "수직교",
		river: "황구지천"
	},
	{
		code: "1101663",
		city: "평택시",
		name: "진위교",
		river: "진위천"
	},
	{
		code: "1101665",
		city: "평택시",
		name: "회화",
		river: "진위천"
	},
	{
		code: "1101670",
		city: "평택시",
		name: "동연교",
		river: "진위천"
	},
	{
		code: "1101680",
		city: "평택시",
		name: "팽성대교",
		river: "안성천"
	}
];
//#endregion
//#region src/hazards.ts
function compactWaterRows(rows) {
	const groups = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const code = field(row, "WALE_OBSVTR_CD");
		if (!code || !feedTimestamp("water", row)) continue;
		const group = groups.get(code) ?? [];
		group.push(row);
		group.sort((a, b) => String(b.YMD_HM).localeCompare(String(a.YMD_HM)));
		const unique = [...new Map(group.map((r) => [String(r.YMD_HM), r])).values()].slice(0, 2);
		groups.set(code, unique);
	}
	return [...groups.values()].flat();
}
//#endregion
//#region src/water-pages.ts
async function stationPages(codes, totalPages, fetchPage) {
	const selected = /* @__PURE__ */ new Set();
	await Promise.all(codes.map(async (code) => {
		let lo = 1, hi = totalPages;
		while (lo <= hi) {
			const page = Math.floor((lo + hi) / 2), rows = await fetchPage(page);
			if (!rows.length) {
				hi = page - 1;
				continue;
			}
			const first = field(rows[0], "WALE_OBSVTR_CD"), last = field(rows[rows.length - 1], "WALE_OBSVTR_CD");
			if (!first || !last || first > last || rows.some((r, i) => i > 0 && field(rows[i - 1], "WALE_OBSVTR_CD") > field(r, "WALE_OBSVTR_CD"))) throw Error("수위 관측소 정렬 확인 필요");
			if (code < first) hi = page - 1;
			else if (code > last) lo = page + 1;
			else {
				if (rows.some((r) => field(r, "WALE_OBSVTR_CD") === code)) selected.add(page);
				if (last === code && page < totalPages) {
					if ((await fetchPage(page + 1)).some((r) => field(r, "WALE_OBSVTR_CD") === code)) selected.add(page + 1);
				}
				break;
			}
		}
	}));
	return [...selected].sort((a, b) => a - b);
}
//#endregion
//#region src/collector.ts
var bindings = () => env;
var db$1 = () => {
	if (!env.DB) throw Error("자료 저장소 연결 대기");
	return env.DB;
};
async function read(id) {
	return db$1().prepare("SELECT id,payload,saved_at,next_due,error FROM feeds WHERE id=?").bind(id).first();
}
async function lease(id, interval, scope = "v1") {
	const now = Date.now();
	return (await db$1().prepare("INSERT INTO feeds(id,next_due,lease_until,scope) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,next_due=excluded.next_due,scope=excluded.scope WHERE feeds.lease_until<=? AND (feeds.next_due<=? OR feeds.scope<>excluded.scope OR (feeds.payload IS NULL AND feeds.error IS NULL))").bind(id, now + interval, now + 9e4, scope, now, now).run()).meta.changes ? now : null;
}
async function quota(id) {
	const key = `${id}:${kstDay()}`;
	if (!(await db$1().prepare("INSERT INTO api_usage(id,calls) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET calls=calls+1 WHERE api_usage.calls<100").bind(key).run()).meta.changes) throw Error("오늘 호출한도 도달 · 저장자료 유지");
}
async function finish(id, payload, error) {
	if (payload !== void 0) await db$1().prepare("UPDATE feeds SET payload=?,saved_at=?,error=?,lease_until=0 WHERE id=?").bind(JSON.stringify(payload), Date.now(), error, id).run();
	else {
		const old = await read(id);
		const retry = Math.min(6 * 36e5, Math.max(36e5, (old?.next_due ?? Date.now()) - Date.now()) * (old?.error ? 2 : 1));
		await db$1().prepare("UPDATE feeds SET error=?,lease_until=0,next_due=? WHERE id=?").bind(error, Date.now() + retry, id).run();
	}
}
async function collectWater(key, started) {
	const config = FEEDS.find((f) => f.id === "water");
	try {
		const cache = /* @__PURE__ */ new Map();
		let requests = 0, total = 0;
		const fetchPage = (page) => {
			const previous = cache.get(page);
			if (previous) return previous;
			const task = (async () => {
				if (requests >= 24) throw Error("수위 관측소 조회 범위 확인 중");
				requests++;
				await quota("water");
				const url = new URL(`https://www.safetydata.go.kr/V2/api/${config.path}`);
				url.searchParams.set("serviceKey", key);
				url.searchParams.set("numOfRows", "1000");
				url.searchParams.set("pageNo", String(page));
				url.searchParams.set("returnType", "json");
				url.searchParams.set("inqDt", kstDay().replace(/-/g, ""));
				const response = await fetch(url, { signal: AbortSignal.timeout(2e4) });
				if (!response.ok) throw Error(`수위 제공기관 응답 지연 (HTTP ${response.status})`);
				const decoded = decodeResponse(await response.json());
				total = Math.max(total, decoded.total);
				return decoded.rows;
			})();
			cache.set(page, task);
			return task;
		};
		const first = await fetchPage(1);
		const totalPages = first.length ? Math.ceil(total / first.length) : 0;
		const selected = totalPages ? await stationPages(WATER_STATIONS.map((s) => s.code), totalPages, fetchPage) : [];
		const pages = await Promise.all([...cache.values()]);
		await finish("water", {
			rows: compactWaterRows(pages.flat()),
			messages: [],
			total,
			complete: total <= first.length,
			receivedCount: pages.reduce((n, r) => n + r.length, 0),
			fields: Object.keys(first[0] ?? {}),
			queryDay: kstDay(),
			selectedPages: selected
		}, null);
		const interval = Math.max(60, requests * 15) * 6e4;
		await db$1().prepare("UPDATE feeds SET next_due=? WHERE id=?").bind(started + interval, "water").run();
	} catch (e) {
		await finish("water", void 0, e instanceof Error && e.name === "TimeoutError" ? "수위 제공기관 응답 지연" : e instanceof Error ? e.message : "수위 관측자료 미확보");
	}
}
async function collectFeed(config) {
	const key = bindings()[config.key];
	if (!key) return;
	const started = await lease(config.id, 60 * 6e4, config.id === "messages" ? `${kstDay()}:day-filter-v3-kst` : `${kstDay()}:regional-v4`);
	if (!started) return;
	if (config.id === "water") return collectWater(key, started);
	try {
		const old = await read(config.id);
		const previous = old?.payload ? JSON.parse(old.payload) : null;
		let rows = [], total = 0, complete = false, pages = 0, receivedCount = 0;
		for (let page = 1; page <= 3; page++) {
			await quota(config.id);
			pages++;
			const url = new URL(`https://www.safetydata.go.kr/V2/api/${config.path}`);
			url.searchParams.set("serviceKey", key);
			url.searchParams.set("numOfRows", "1000");
			url.searchParams.set("pageNo", String(page));
			url.searchParams.set("returnType", "json");
			if (config.id === "messages") url.searchParams.set("crtDt", kstDay().replace(/-/g, ""));
			if (config.id === "prediction") url.searchParams.set("inqDt", kstDay().replace(/-/g, ""));
			if (config.id === "fire") url.searchParams.set("startDt", kstDay().replace(/-/g, ""));
			const r = await fetch(url, { signal: AbortSignal.timeout(2e4) });
			if (!r.ok) throw Error(`제공기관 연결 지연 (HTTP ${r.status})`);
			let value;
			try {
				value = await r.json();
			} catch {
				throw Error("제공기관 응답 형식 확인 필요");
			}
			const decoded = decodeResponse(value);
			total = decoded.total;
			receivedCount += decoded.rows.length;
			rows = [...rows, ...decoded.rows];
			if (!decoded.rows.length || receivedCount >= total) {
				complete = true;
				break;
			}
		}
		const parsed = config.id === "messages" ? parseMessages(rows) : [];
		if (config.id === "messages" && rows.length && !parsed.length) throw Error("재난문자 필드 형식 확인 필요");
		if (config.id === "messages" && parsed.some((m) => kstDay(Date.parse(m.at)) !== kstDay())) throw Error("오늘 날짜 조회조건 확인 필요 · 과거자료 제외");
		const byId = new Map([...previous?.messageTimeVersion === 2 ? previous.messages ?? [] : [], ...parsed].filter((m) => Date.now() - Date.parse(m.at) < 7 * 864e5).map((m) => [m.id, m]));
		await finish(config.id, {
			messageTimeVersion: 2,
			timestampSamples: config.id === "messages" ? rows.slice(0, 3).map((r) => ({
				id: r.SN,
				raw: r.CRT_DT
			})) : void 0,
			rows: config.id === "messages" ? [] : rows,
			messages: [...byId.values()],
			total,
			complete,
			receivedCount,
			queryDay: [
				"messages",
				"water",
				"prediction",
				"fire"
			].includes(config.id) ? kstDay() : null,
			fields: Object.keys(rows[0] ?? {})
		}, null);
		await db$1().prepare("UPDATE feeds SET next_due=? WHERE id=?").bind(started + Math.max(60, pages * 20) * 6e4, config.id).run();
	} catch (e) {
		await finish(config.id, void 0, e instanceof Error && e.name === "TimeoutError" ? "제공기관 응답 지연" : e instanceof Error ? e.message : "수집 지연 · 저장자료 유지");
	}
}
async function refreshShared() {}
async function collectAll() {
	const jobs = [refreshShared, ...FEEDS.map((config) => () => collectFeed(config))];
	await Promise.allSettled(Array.from({ length: 3 }, async () => {
		for (let job; job = jobs.shift();) await job().catch(() => {});
	}));
}
async function loadSituation() {
	const [rows, calls] = await Promise.all([db$1().prepare("SELECT id,payload,saved_at,next_due,error FROM feeds").all(), db$1().prepare("SELECT id,calls FROM api_usage WHERE id LIKE ?").bind(`%:${kstDay()}`).all()]);
	const map = new Map(rows.results.map((r) => [r.id, r]));
	const s = map.get("shared");
	const stored = s?.payload ? JSON.parse(s.payload) : {};
	const feeds = FEEDS.map((config) => {
		const saved = map.get(config.id);
		const p = saved?.payload ? JSON.parse(saved.payload) : {};
		const configured = !!bindings()[config.key];
		return {
			id: config.id,
			name: config.name,
			state: !configured ? config.id === "water" ? "승인 대기" : "승인·키 등록 대기" : saved?.error ? "수신 지연" : saved?.saved_at ? "수신 중" : "첫 수신 대기",
			savedAt: saved?.saved_at ? new Date(saved.saved_at).toISOString() : null,
			error: saved?.error ?? null,
			rows: publicRows(config.id, p.rows ?? []),
			messages: p.messages ?? [],
			complete: p.complete,
			total: p.total,
			fields: p.fields,
			receivedCount: p.receivedCount,
			calls: calls.results.find((x) => x.id === `${config.id}:${kstDay()}`)?.calls ?? 0,
			nextDue: saved?.next_due
		};
	});
	for (const feed of feeds) if (feed.id !== "messages" && bindings()[FEEDS.find((f) => f.id === feed.id).key]) feed.state = feedHealth(feed).state;
	return {
		at: new Date(Math.max(0, ...rows.results.map((r) => r.saved_at ?? 0))).toISOString(),
		feeds,
		warnings: stored.warnings ?? null,
		weather: stored.weather ?? null,
		sharedError: s?.error ?? null
	};
}
var WARNING_INTERVAL = 30 * 6e4;
//#endregion
//#region src/weather/warnings.ts
var GYEONGGI_CITIES = [
	"수원시",
	"성남시",
	"의정부시",
	"안양시",
	"부천시",
	"광명시",
	"평택시",
	"동두천시",
	"안산시",
	"고양시",
	"과천시",
	"구리시",
	"남양주시",
	"오산시",
	"시흥시",
	"군포시",
	"의왕시",
	"하남시",
	"용인시",
	"파주시",
	"이천시",
	"안성시",
	"김포시",
	"화성시",
	"광주시",
	"양주시",
	"포천시",
	"여주시",
	"연천군",
	"가평군",
	"양평군"
];
var kinds = "강풍|호우|한파|건조|폭풍해일|풍랑|태풍|대설|황사|폭염|열대야|안개|지진해일";
function warningDate(raw) {
	const s = String(raw ?? "");
	return /^\d{12}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00` : null;
}
function emptyWarnings() {
	return {
		verified: false,
		collectedAt: null,
		issuedAt: null,
		effectiveAt: null,
		cities: GYEONGGI_CITIES.map((name) => ({
			name,
			active: [],
			preliminary: []
		})),
		rawCurrent: "",
		rawPreliminary: "",
		notes: "",
		parseNotes: [],
		error: "특보 자료 확인 중"
	};
}
function splitAreas(text) {
	let depth = 0, start = 0;
	const result = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "(") depth++;
		if (text[i] === ")") depth--;
		if ((text[i] === "," || text[i] === "，") && depth === 0) {
			result.push(text.slice(start, i).trim());
			start = i + 1;
		}
	}
	result.push(text.slice(start).trim());
	return result.filter(Boolean);
}
function gyeonggiAreas(text) {
	const matches = [];
	let unresolved = false;
	for (const match of text.matchAll(/경기도/g)) {
		let i = match.index + 3;
		while (/\s/.test(text[i] ?? "") && i < text.length) i++;
		if (text[i] === "(") {
			let depth = 1, start = ++i;
			for (; i < text.length && depth; i++) {
				if (text[i] === "(") depth++;
				if (text[i] === ")") depth--;
			}
			if (depth) {
				unresolved = true;
				continue;
			}
			matches.push(text.slice(start, i - 1));
		} else if (!text[i] || /[,，\s.]/.test(text[i])) matches.push("전체");
		else unresolved = true;
	}
	return {
		matches,
		unresolved
	};
}
function parseWarningStatus(row, now) {
	if (typeof row.t6 !== "string" || !row.t6.trim()) throw new Error("특보 발효현황 내용이 없습니다.");
	const data = emptyWarnings();
	data.verified = true;
	data.error = null;
	data.collectedAt = now.toISOString();
	data.issuedAt = warningDate(row.tmFc);
	data.effectiveAt = warningDate(row.tmEf);
	data.rawCurrent = row.t6.replace(/\\n/g, "\n");
	data.rawPreliminary = String(row.t7 ?? "").replace(/\\n/g, "\n");
	data.notes = String(row.other ?? "");
	function apply(text, preliminary) {
		const regex = new RegExp(`(${kinds})\\s*(중대경보|경보|주의보|예비특보)\\s*[:：]?`, "g");
		const headings = [...text.matchAll(regex)];
		if (!preliminary && /경기도/.test(text) && !headings.length) data.parseNotes.push("경기도 특보 형식 확인 필요");
		headings.forEach((m, index) => {
			const kind = m[1], level = preliminary ? "예비특보" : m[2];
			if (!preliminary && level === "예비특보") return;
			const section = text.slice(m.index + m[0].length, headings[index + 1]?.index ?? text.length);
			const { matches, unresolved } = gyeonggiAreas(section);
			if (unresolved) data.parseNotes.push(`${kind} ${level} 구역 확인 필요`);
			const targets = /* @__PURE__ */ new Map();
			if (/경기(?:북부|남부)/.test(section) && !matches.length) data.parseNotes.push(`${kind} ${level} 광역 구역 확인 필요`);
			if (!matches.length) for (const name of GYEONGGI_CITIES) {
				const found = section.match(new RegExp(`(?:^|[\\s,(])(${name}(?:[동서남북][^,()\\s]*)?)(?=$|[,()\\s])`));
				if (found) targets.set(name, [found[1]]);
			}
			for (const list of matches) {
				const excluded = /제외/.test(list);
				const areas = splitAreas(list);
				if (list === "전체") {
					for (const name of GYEONGGI_CITIES) targets.set(name, ["경기도 전체"]);
					continue;
				}
				if (excluded && !/\([^)]*제외\)/.test(list)) {
					const excludedCities = GYEONGGI_CITIES.filter((name) => list.includes(name) || list.includes(name.slice(0, -1)));
					for (const name of GYEONGGI_CITIES) if (!excludedCities.includes(name)) targets.set(name, ["경기도 전체(일부 시군 제외)"]);
					continue;
				}
				for (const area of areas) {
					const city = GYEONGGI_CITIES.find((name) => area.replace(/\s/g, "").startsWith(name) || area.replace(/\s/g, "").startsWith(name.slice(0, -1)));
					if (city) {
						const names = targets.get(city) ?? [];
						names.push(area);
						targets.set(city, names);
					} else data.parseNotes.push(`${kind} ${level}: ${area} 구역 확인 필요`);
				}
			}
			for (const city of data.cities) {
				const areas = targets.get(city.name);
				if (!areas) continue;
				const entries = preliminary ? city.preliminary : city.active;
				const previous = entries.find((x) => x.kind === kind && x.level === level);
				if (previous) previous.areas = [...new Set([...previous.areas, ...areas])];
				else entries.push({
					kind,
					level,
					areas: [...new Set(areas)],
					timing: preliminary ? section.split(/[:：]/)[0].replace(/^[\s\no○]+/, "").trim() : data.effectiveAt ?? ""
				});
			}
		});
	}
	apply(data.rawCurrent, false);
	apply(data.rawPreliminary, true);
	data.parseNotes = [...new Set(data.parseNotes)];
	if (data.parseNotes.length) data.verified = false;
	return data;
}
//#endregion
//#region src/weather/warning-store.ts
function db() {
	if (!env.DB) throw new Error("특보 저장소 연결 확인 중");
	return env.DB;
}
async function readWarnings() {
	const row = await db().prepare("SELECT payload FROM warning_snapshot WHERE id='gyeonggi'").first();
	return row ? JSON.parse(row.payload) : null;
}
async function collectWarnings() {
	const started = Date.now();
	if (!(await db().prepare("INSERT INTO collection_state (id,next_due,lease_until,last_started,last_finished,last_error) VALUES ('warnings',0,?,?,NULL,NULL) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,last_started=excluded.last_started WHERE collection_state.lease_until<=? AND (collection_state.next_due<=? OR collection_state.last_started<=?)").bind(started + 6e4, started, started, started, started - 18e5).run()).meta.changes) return;
	let error = null;
	const previous = await readWarnings();
	let data = emptyWarnings();
	try {
		const bindings = env;
		if (!bindings.KMA_API_KEY) throw new Error("기상청 인증키 설정 필요");
		let key = bindings.KMA_API_KEY;
		try {
			key = decodeURIComponent(key);
		} catch {}
		const url = new URL("https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus");
		for (const [k, v] of Object.entries({
			serviceKey: key,
			numOfRows: "10",
			pageNo: "1",
			dataType: "JSON"
		})) url.searchParams.set(k, v);
		const response = await fetch(url, { signal: AbortSignal.timeout(8e3) });
		if (!response.ok) throw new Error("기상특보 제공기관 응답 지연");
		const json = await response.json();
		const head = json.response?.header;
		if (!["00", "0"].includes(String(head?.resultCode))) throw new Error("기상특보 현황 자료 확인 중");
		const rows = json.response?.body?.items?.item;
		const items = Array.isArray(rows) ? rows : rows ? [rows] : [];
		items.sort((a, b) => String(b.tmFc).localeCompare(String(a.tmFc)));
		if (!items.length) throw new Error("제공기관의 최근 특보 현황 자료 없음");
		data = parseWarningStatus(items[0], /* @__PURE__ */ new Date());
		if (!data.verified) throw new Error(data.parseNotes.join(" · "));
		if (previous?.issuedAt && data.issuedAt && data.issuedAt < previous.issuedAt) data = {
			...previous,
			collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
			error: null
		};
	} catch {
		error = "기상특보 수집 지연 · 마지막 저장 현황 표시";
		data = previous ? {
			...previous,
			error
		} : {
			...data,
			error
		};
		data.error = error;
	}
	await db().batch([db().prepare("INSERT INTO warning_snapshot (id,payload,saved_at) VALUES ('gyeonggi',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at").bind(JSON.stringify(data), data.collectedAt ? Date.parse(data.collectedAt) : 0), db().prepare("UPDATE collection_state SET lease_until=0,next_due=?,last_finished=?,last_error=? WHERE id='warnings' AND last_started=?").bind(started + WARNING_INTERVAL, Date.now(), error, started)]);
}
//#endregion
//#region src/weather/weather.ts
var kst = (date) => new Date(date.getTime() + 9 * 36e5);
var pad = (n) => String(n).padStart(2, "0");
function stamp(date) {
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}
function baseFor(kind, now, back = 0) {
	const d = kst(now);
	if (kind === "getVilageFcst") {
		d.setUTCMinutes(d.getUTCMinutes() - 15);
		const h = [
			23,
			20,
			17,
			14,
			11,
			8,
			5,
			2
		].find((h) => h <= d.getUTCHours());
		if (h === void 0) {
			d.setUTCDate(d.getUTCDate() - 1);
			d.setUTCHours(23, 0, 0, 0);
		} else d.setUTCHours(h, 0, 0, 0);
		d.setUTCHours(d.getUTCHours() - back * 3);
	} else if (kind === "getUltraSrtFcst") {
		d.setUTCMinutes(d.getUTCMinutes() - 45);
		d.setUTCMinutes(30, 0, 0);
		d.setUTCHours(d.getUTCHours() - back);
	} else {
		d.setUTCMinutes(d.getUTCMinutes() - 40);
		d.setUTCMinutes(0, 0, 0);
		d.setUTCHours(d.getUTCHours() - back);
	}
	return {
		date: stamp(d),
		time: pad(d.getUTCHours()) + pad(d.getUTCMinutes())
	};
}
var at = (date, time) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`;
function number(v) {
	if (v === void 0 || v === null || v === "" || v === "-" || !Number.isFinite(Number(v))) return null;
	return Number(v);
}
function condition(v) {
	const p = number(v.PTY);
	if (p !== null && p !== 0) return {
		1: "비",
		2: "비·눈",
		3: "눈",
		4: "소나기",
		5: "빗방울",
		6: "빗방울·눈날림",
		7: "눈날림"
	}[p] ?? "강수";
	return {
		1: "맑음",
		3: "구름 많음",
		4: "흐림"
	}[Number(v.SKY)] ?? "하늘상태 확인 중";
}
function advice(data, now) {
	const notices = [];
	const current = data.observedAt && now.getTime() - Date.parse(data.observedAt) < 2 * 36e5 ? data.current : {};
	const hours = data.hours.filter((h) => Date.parse(h.at) >= now.getTime() && Date.parse(h.at) < now.getTime() + 24 * 36e5);
	const nextRain = hours.find((h) => (number(h.values.PTY) ?? 0) > 0 || (number(h.values.POP) ?? 0) >= 60);
	if (nextRain) notices.push({
		title: "우산을 준비하세요",
		body: `${new Intl.DateTimeFormat("ko-KR", {
			timeZone: "Asia/Seoul",
			month: "numeric",
			day: "numeric",
			hour: "numeric"
		}).format(new Date(nextRain.at))} ${condition(nextRain.values)} 또는 강수 가능성이 높게 예보되어 있습니다. 외출 전 최신 예보를 확인하세요.`,
		level: "watch"
	});
	const temps = hours.map((h) => number(h.values.TMP ?? h.values.T1H)).filter((v) => v !== null);
	const today = stamp(kst(now)), day = data.daily.find((d) => d.date === today);
	if (day?.min !== null && day?.max !== null && day && day.max - day.min >= 10) notices.push({
		title: "큰 일교차에 대비하세요",
		body: `오늘 예보 최저 ${day.min}° · 최고 ${day.max}°. 아침·저녁에는 겉옷을 준비하세요.`,
		level: "info"
	});
	if ([number(current.WSD), ...hours.map((h) => number(h.values.WSD))].filter((v) => v !== null).some((v) => v >= 9)) notices.push({
		title: "강한 바람에 주의하세요",
		body: "실황 또는 향후 24시간 예보에서 풍속 9m/s 이상이 확인됩니다. 야외 설치물을 점검하고 바람이 강한 곳에서 주의하세요.",
		level: "watch"
	});
	if (temps.some((t) => t >= 33) || (number(current.T1H) ?? -99) >= 33) notices.push({
		title: "더운 시간대 야외활동 주의",
		body: "기온 33°C 이상인 시간대가 있습니다. 야외활동 시 그늘에서 쉬고 물을 충분히 드세요.",
		level: "watch"
	});
	if (temps.some((t) => t <= 0) || (number(current.T1H) ?? 99) <= 0) notices.push({
		title: "영하 기온·미끄럼 주의",
		body: "영하 기온이 관측되거나 예보되어 있습니다. 젖은 도로와 그늘진 보행로가 얼 수 있으니 주의하세요.",
		level: "watch"
	});
	if ((number(current.RN1) ?? 0) >= 10) notices.push({
		title: "현재 강수량 증가",
		body: "1시간 강수량이 10mm 이상입니다. 하천변·지하차도 등은 현장 통제 안내를 확인하세요.",
		level: "watch"
	});
	if ((number(current.REH) ?? 100) <= 30) notices.push({
		title: "건조한 공기·화기 주의",
		body: "현재 상대습도가 30% 이하입니다. 산 주변에서 화기를 사용하지 말고 불씨를 주의하세요.",
		level: "info"
	});
	if (data.air && Date.parse(data.air.dataTime?.replace(" ", "T") + "+09:00") > now.getTime() - 3 * 36e5) {
		if (["3", "4"].includes(data.air.pm10Grade1h) || ["3", "4"].includes(data.air.pm25Grade1h)) notices.push({
			title: "미세먼지 나쁨 이상",
			body: "측정소에서 제공한 현재 미세먼지 등급이 나쁨 이상입니다. 어린이·어르신은 장시간 야외활동을 줄이세요.",
			level: "watch"
		});
		if (["3", "4"].includes(data.air.o3Grade)) notices.push({
			title: "오존 농도 주의",
			body: "측정소에서 제공한 오존 등급이 나쁨 이상입니다. 한낮의 장시간 야외활동을 줄이세요.",
			level: "watch"
		});
	}
	if (!notices.length) notices.push({
		title: hours.length ? "외출 전 최신 예보 확인" : "기상자료 연결 확인 중",
		body: hours.length ? "시간대별 기온과 강수확률을 확인하고 외출을 준비하세요. 지역·시간에 따라 실제 날씨는 달라질 수 있습니다." : "자료가 연결되면 예보에 따른 시민 안내가 자동으로 표시됩니다. 현재 날씨는 기상청 날씨누리를 확인하세요.",
		level: "info"
	});
	return notices;
}
var AIR_STATIONS = {
	"의정부1동": {
		address: "의정부시 가능로152번길 14 의정부1동 작은도서관",
		area: "도심 북부·서부 생활권"
	},
	"의정부동": {
		address: "의정부시 범골로 138 경기도도로사업소",
		area: "도심·남부 생활권"
	},
	"송산3동": {
		address: "의정부시 민락로243번길 94 푸른마당 근린공원 인근",
		area: "송산·고산 생활권"
	}
};
function stationForRegion(region) {
	if ([
		"송산1동",
		"송산2동",
		"송산3동",
		"고산동"
	].includes(region.name)) return "송산3동";
	if ([
		"의정부1동",
		"신곡2동",
		"자금동",
		"가능동",
		"흥선동",
		"녹양동"
	].includes(region.name)) return "의정부1동";
	return "의정부동";
}
//#endregion
//#region src/weather/air.ts
function airTimestamp(value) {
	if (!value) return null;
	const date = Date.parse(value.replace(" ", "T") + "+09:00");
	return Number.isFinite(date) ? date : null;
}
function issuedTimestamp(value) {
	const m = value.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2})(?::(\d{2}))?/);
	return m ? Date.parse(`${m[1]}T${m[2].padStart(2, "0")}:${m[3] ?? "00"}:00+09:00`) : 0;
}
function metricValue(row, code) {
	if (!row || row[code + "Flag"]) return null;
	return number(row[code + "Value"]);
}
function airGrade(row, code) {
	if (metricValue(row, code) === null) return null;
	const value = row?.[code + (code === "pm10" || code === "pm25" ? "Grade1h" : "Grade")];
	return [
		"1",
		"2",
		"3",
		"4"
	].includes(String(value)) ? Number(value) : null;
}
function regionalGrade(text) {
	const pairs = text.split(/[,，]/).map((s) => s.trim());
	for (const name of [
		"경기북부",
		"경기",
		"경기도"
	]) {
		const pair = pairs.find((s) => s.split(":")[0]?.trim() === name);
		if (pair) return {
			region: name,
			grade: pair.slice(pair.indexOf(":") + 1).trim()
		};
	}
	return {
		region: "경기북부",
		grade: "자료 없음"
	};
}
function forecastDate(row) {
	const raw = row.informData ?? row.fcstDate ?? row.forecastDate ?? "";
	return raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? (/^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "");
}
function normalizeForecasts(rows, today) {
	const map = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const date = forecastDate(row);
		if (!date || date < today || ![
			"PM10",
			"PM25",
			"O3"
		].includes(row.informCode)) continue;
		const code = row.informCode, regional = regionalGrade(row.informGrade ?? "");
		const entry = {
			date,
			issuedAt: row.dataTime ?? "",
			code,
			...regional,
			overall: row.informOverall ?? row.infornOverall ?? "",
			cause: row.informCause ?? "",
			action: row.actionKnack ?? ""
		};
		const old = map.get(date + code);
		if (!old || issuedTimestamp(entry.issuedAt) > issuedTimestamp(old.issuedAt)) map.set(date + code, entry);
	}
	return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
}
function normalizeHigh(rows, today) {
	const map = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const date = forecastDate(row);
		if (!date || date < today) continue;
		const flag = (row.gyeonggibuk50Over ?? "").trim().toUpperCase();
		const entry = {
			date,
			issuedAt: row.dataTime ?? "",
			region: "경기북부",
			over50: flag === "O" ? true : flag === "X" || Object.prototype.hasOwnProperty.call(row, "gyeonggibuk50Over") && row.gyeonggibuk50Over === null ? false : null,
			grade: row.gyeonggibukGrade ?? "자료 없음",
			cause: row.informCause ?? row.informOverall ?? ""
		};
		const old = map.get(date);
		if (!old || issuedTimestamp(entry.issuedAt) > issuedTimestamp(old.issuedAt)) map.set(date, entry);
	}
	return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function combinedAdvice(data, now) {
	const notices = [];
	const air = data.air;
	const airAt = airTimestamp(air?.dataTime);
	const usable = air && [
		"pm10",
		"pm25",
		"o3",
		"no2",
		"co",
		"so2"
	].some((code) => metricValue(air, code) !== null);
	const fresh = Boolean(usable) && airAt !== null && now.getTime() - airAt >= -36e5 && now.getTime() - airAt < 3 * 36e5;
	const weatherFresh = data.observedAt && now.getTime() - Date.parse(data.observedAt) < 2 * 36e5;
	const high = data.highForecasts?.filter((x) => x.over50 === true && issuedTimestamp(x.issuedAt) > now.getTime() - 36 * 36e5) ?? [];
	if (high.length) notices.push({
		title: "고농도 초미세먼지 전망에 대비하세요",
		body: `${high.map((x) => x.date.slice(5)).join("·")} 경기북부에서 초미세먼지 50㎍/㎥ 초과가 예보되었습니다. 민감군은 장시간 실외활동을 줄이고, 야외 일정은 최신 예보를 확인해 조정하세요. 비상저감조치 발령 여부는 별도 공지를 확인하세요.`,
		level: "watch"
	});
	const badNow = fresh && ["pm10", "pm25"].some((code) => (airGrade(air, code) ?? 0) >= 3);
	const badOzone = fresh && (airGrade(air, "o3") ?? 0) >= 3;
	if (badNow) notices.push({
		title: "미세먼지·야외활동 주의",
		body: `${air?.stationName} 측정소의 현재 먼지 등급이 나쁨 이상입니다. 어린이·어르신·호흡기 민감군은 장시간 실외활동을 줄이고, 환기는 최신 농도를 확인해 짧게 하세요.`,
		level: "watch"
	});
	if (badOzone) notices.push({
		title: "오존이 높은 시간대 활동 조정",
		body: `${air?.stationName} 측정소의 현재 오존 등급이 나쁨 이상입니다. 한낮의 장시간 야외활동을 줄이고 실내에서 쉬세요.`,
		level: "watch"
	});
	const badFuture = data.airForecasts?.filter((x) => [
		"나쁨",
		"매우나쁨",
		"매우 나쁨"
	].includes(x.grade) && issuedTimestamp(x.issuedAt) > now.getTime() - 36 * 36e5) ?? [];
	if (badFuture.length) notices.push({
		title: "앞으로의 대기질을 확인하세요",
		body: `${badFuture.slice(0, 3).map((x) => `${x.date.slice(5)} ${x.code === "PM25" ? "초미세먼지" : x.code === "PM10" ? "미세먼지" : "오존"} ${x.grade}`).join(" · ")} (${badFuture[0].region} 권역 예보). 야외 행사·운동 계획은 당일 측정값도 함께 확인하세요.`,
		level: "watch"
	});
	if (fresh && weatherFresh) {
		const pm25 = metricValue(air, "pm25"), temp = number(data.current.T1H), wind = number(data.current.WSD), rain = number(data.current.RN1);
		const facts = [
			temp === null ? null : `기온 ${temp}°C`,
			wind === null ? null : `풍속 ${wind}m/s`,
			pm25 === null ? "초미세먼지 측정자료 없음" : `초미세먼지 ${pm25}㎍/㎥`
		].filter(Boolean).join(" · ");
		const nextRain = data.hours.find((x) => Date.parse(x.at) >= now.getTime() && Date.parse(x.at) < now.getTime() + 12 * 36e5 && ((number(x.values.PTY) ?? 0) > 0 || (number(x.values.POP) ?? 0) >= 60));
		const text = badNow || badOzone ? "대기질을 우선 고려해 야외활동 시간을 줄이세요." : rain !== null && rain > 0 || nextRain ? "대기질과 함께 강수 예보도 확인하고, 우산과 미끄럼에 대비하세요." : wind !== null && wind >= 9 ? "대기질과 함께 강한 바람에도 대비해 야외 설치물과 이동 경로를 확인하세요." : "외출 전 시간대별 기온·강수와 최신 대기질을 함께 확인하세요.";
		notices.push({
			title: "날씨·대기질 종합 생활안내",
			body: `${facts}. ${text} 대기질은 ${air?.stationName} 측정소 기준입니다.`,
			level: badNow || badOzone ? "watch" : "info"
		});
	}
	const pmForecast = data.airForecasts?.find((f) => f.code === "PM25" && f.date === new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Seoul",
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).format(now) && issuedTimestamp(f.issuedAt) > now.getTime() - 36 * 36e5);
	if (pmForecast && !badFuture.length) notices.push({
		title: "오늘의 날씨·대기질 전망",
		body: `${pmForecast.region}의 오늘 초미세먼지 예보는 '${pmForecast.grade}'입니다. ${data.notices.find((n) => n.title === "큰 일교차에 대비하세요")?.body ?? "외출 전 시간대별 기온과 강수확률을 확인하세요."} 권역 예보와 현재 측정농도는 서로 다를 수 있습니다.`,
		level: "info"
	});
	if (!fresh) notices.push({
		title: "대기질 최신 자료 확인 필요",
		body: air && !usable ? "측정소의 통신장애·점검 또는 결측으로 현재 대기질 수치를 확인할 수 없습니다. 측정값을 정상·안전으로 판단하지 않고 권역 예보와 날씨를 함께 확인하세요." : air ? "대기측정 자료가 3시간 이상 지연되었거나 시각을 확인할 수 없어 최신 생활안내 분석에서 제외했습니다." : "현재 대기측정 자료를 확인하지 못했습니다. 날씨 안내와 함께 에어코리아의 최신 대기질도 확인하세요.",
		level: "info"
	});
	notices.push(...data.notices.filter((n) => !["미세먼지 나쁨 이상", "오존 농도 주의"].includes(n.title)));
	return notices;
}
//#endregion
//#region src/weather/api-cache.ts
async function readApiCache(key) {
	if (!env.DB) return void 0;
	try {
		const row = await env.DB.prepare("SELECT payload FROM api_cache WHERE cache_key = ? AND expires_at > ?").bind(key, Date.now()).first();
		return row ? JSON.parse(row.payload) : void 0;
	} catch {
		return;
	}
}
async function writeApiCache(key, value, ttl) {
	if (!env.DB) return;
	try {
		await env.DB.prepare("INSERT INTO api_cache (cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at").bind(key, JSON.stringify(value), Date.now() + ttl * 1e3).run();
	} catch {}
}
//#endregion
//#region src/weather/weather-collector.ts
var memo = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
function key(raw) {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
async function getJSON(url, cacheKey, ttl, allowEmpty = false) {
	const cached = memo.get(cacheKey);
	if (cached && cached.until > Date.now()) return cached.value;
	if (inflight.has(cacheKey)) return inflight.get(cacheKey);
	const work = (async () => {
		const stored = await readApiCache(cacheKey);
		if (stored !== void 0) return stored;
		let cache;
		try {
			cache = typeof caches !== "undefined" ? caches.default : void 0;
		} catch {
			cache = void 0;
		}
		const request = new Request("https://weather-cache.invalid/" + cacheKey);
		if (cache) try {
			const r = await cache.match(request);
			if (r) return await r.json();
		} catch {
			cache = void 0;
		}
		let r;
		try {
			r = await fetch(url, { signal: AbortSignal.timeout(6e3) });
		} catch {
			throw new Error("기상자료 제공기관에 연결할 수 없습니다.");
		}
		if (!r.ok) throw new Error("자료 제공기관 응답 지연");
		const text = await r.text();
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			const code = text.match(/<returnReasonCode>([^<]*)</)?.[1];
			throw new Error(code === "30" ? "API 활용승인 또는 인증키를 확인해 주세요." : "제공기관이 자료를 반환하지 않았습니다. 잠시 후 다시 확인합니다.");
		}
		const header = parsed.response?.header;
		if (!header || !["00", "0"].includes(String(header.resultCode))) throw new Error([
			"30",
			"31",
			"32"
		].includes(String(header?.resultCode)) ? "API 활용승인 또는 인증키를 확인해 주세요." : `제공기관 자료 준비 중 (${header?.resultCode ?? "응답 오류"})`);
		const rawItems = parsed.response?.body?.items?.item ?? parsed.response?.body?.items;
		const items = Array.isArray(rawItems) ? rawItems : rawItems && typeof rawItems === "object" ? [rawItems] : [];
		if (!allowEmpty && !items.length) throw new Error("해당 발표시각의 자료가 아직 없습니다.");
		await writeApiCache(cacheKey, items, ttl);
		memo.set(cacheKey, {
			until: Date.now() + ttl * 1e3,
			value: items
		});
		if (cache) try {
			await cache.put(request, new Response(JSON.stringify(items), { headers: {
				"Content-Type": "application/json",
				"Cache-Control": `public, max-age=${ttl}`
			} }));
		} catch {}
		return items;
	})();
	inflight.set(cacheKey, work);
	try {
		return await work;
	} finally {
		inflight.delete(cacheKey);
	}
}
async function weather(kind, now, raw, grid) {
	let message = "자료 연결 확인 중";
	if (!raw) return {
		items: [],
		source: {
			ok: false,
			message: "기상청 인증키 설정이 필요합니다.",
			base: null
		}
	};
	for (let back = 0; back < 2; back++) {
		const base = baseFor(kind, now, back);
		const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/" + kind);
		for (const [k, v] of Object.entries({
			serviceKey: key(raw),
			pageNo: "1",
			numOfRows: kind === "getVilageFcst" ? "1500" : "1000",
			dataType: "JSON",
			base_date: base.date,
			base_time: base.time,
			nx: String(grid.nx),
			ny: String(grid.ny)
		})) url.searchParams.set(k, v);
		try {
			return {
				items: await getJSON(url, `${kind}-${base.date}-${base.time}-${grid.nx}-${grid.ny}`, 86400),
				source: {
					ok: true,
					message: "연결됨",
					base: at(base.date, base.time)
				}
			};
		} catch (e) {
			message = e instanceof Error ? e.message : message;
			if (message.includes("인증키")) break;
		}
	}
	return {
		items: [],
		source: {
			ok: false,
			message,
			base: null
		}
	};
}
async function collectWeather(grid) {
	const now = /* @__PURE__ */ new Date();
	const bindings = env;
	const day = stamp(kst(now)), searchDate = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
	const station = stationForRegion(grid);
	const airKey = bindings.AIRKOREA_API_KEY ?? "";
	const ttl = Math.max(60, Math.ceil((36e5 - Date.now() % 36e5) / 1e3));
	async function airCall(path, params, cacheKey) {
		if (!airKey) return {
			items: [],
			source: {
				ok: false,
				message: "대기질 인증키 설정 필요",
				base: null
			}
		};
		try {
			const url = new URL("https://apis.data.go.kr/B552584/" + path);
			for (const [k, v] of Object.entries({
				serviceKey: key(airKey),
				returnType: "json",
				pageNo: "1",
				numOfRows: "100",
				...params
			})) url.searchParams.set(k, v);
			const items = await getJSON(url, cacheKey, ttl, true);
			const base = items.map((x) => x.dataTime ?? "").sort((a, b) => issuedTimestamp(b) - issuedTimestamp(a))[0] ?? null;
			return {
				items,
				source: {
					ok: true,
					message: items.length ? "연결됨" : "해당 날짜의 발표 자료 없음",
					base
				}
			};
		} catch (e) {
			return {
				items: [],
				source: {
					ok: false,
					message: e instanceof Error ? e.message : "대기질 연결 확인 중",
					base: null
				}
			};
		}
	}
	const [current, ultra, forecast, airResult, airForecastResult, highResult] = await Promise.all([
		weather("getUltraSrtNcst", now, bindings.KMA_API_KEY ?? "", grid),
		weather("getUltraSrtFcst", now, bindings.KMA_API_KEY ?? "", grid),
		weather("getVilageFcst", now, bindings.KMA_API_KEY ?? "", grid),
		airCall("ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty", {
			stationName: station,
			dataTerm: "DAILY",
			ver: "1.3",
			numOfRows: "24"
		}, `air-current-${encodeURIComponent(station)}`),
		airCall("ArpltnInforInqireSvc/getMinuDustFrcstDspth", { searchDate }, `air-forecast-${searchDate}`),
		airCall("MinuDustFrcstDspthSvc/getMinuDustFrcstDspth50Over", {
			searchDate,
			informCode: "PM25"
		}, `air-high-${searchDate}`)
	]);
	let activeStation = station;
	let activeAirResult = airResult;
	let fallbackReason = "";
	const records = (rows, name) => rows.slice().sort((a, b) => String(b.dataTime).localeCompare(String(a.dataTime))).map((x) => ({
		...x,
		stationName: name
	}));
	const usable = (rows) => {
		const row = rows[0];
		const date = airTimestamp(row?.dataTime);
		return date !== null && now.getTime() - date < 3 * 36e5 && ["pm10", "pm25"].some((code) => metricValue(row, code) !== null);
	};
	if (!usable(records(airResult.items, station)) && airKey) {
		const alternatives = [
			"의정부1동",
			"의정부동",
			"송산3동"
		].filter((s) => s !== station);
		const found = (await Promise.all(alternatives.map(async (name) => ({
			name,
			result: await airCall("ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty", {
				stationName: name,
				dataTerm: "DAILY",
				ver: "1.3",
				numOfRows: "24"
			}, `air-current-${encodeURIComponent(name)}`)
		})))).find((x) => usable(records(x.result.items, x.name)));
		if (found) {
			activeStation = found.name;
			activeAirResult = found.result;
			fallbackReason = `${station} 측정자료 없음 → ${activeStation} 대체`;
			activeAirResult.source.message = `연결됨 · ${fallbackReason}`;
		}
	}
	const airHistory = records(activeAirResult.items, activeStation);
	if (!airHistory.length && activeAirResult.source.ok) {
		activeAirResult.source.ok = false;
		activeAirResult.source.message = "측정소 자료 없음";
	}
	if (airHistory.length) activeAirResult.source.base = airHistory[0].dataTime;
	const today = stamp(kst(now));
	let dailyItems = forecast.items;
	if (forecast.source.ok && !forecast.items.some((x) => x.fcstDate === today && x.category === "TMN") && kst(now).getUTCHours() >= 3) {
		const dawn = await weather("getVilageFcst", new Date(at(today, "0230")), bindings.KMA_API_KEY ?? "", grid);
		if (dawn.source.ok) dailyItems = [...dawn.items.filter((x) => x.fcstDate === today && ["TMN", "TMX"].includes(x.category) && !forecast.items.some((v) => v.fcstDate === today && v.category === x.category)), ...forecast.items];
	}
	const values = {};
	for (const x of current.items) values[x.category] = String(x.obsrValue);
	const grouped = /* @__PURE__ */ new Map();
	for (const [items, source] of [[forecast.items, "단기예보"], [ultra.items, "초단기예보"]]) for (const x of items) {
		const time = at(x.fcstDate, x.fcstTime);
		const h = grouped.get(time) ?? {
			at: time,
			values: {},
			source
		};
		h.values[x.category] = String(x.fcstValue);
		h.source = source;
		grouped.set(time, h);
	}
	const all = [...grouped.values()].sort((a, b) => a.at.localeCompare(b.at));
	const daily = [];
	for (const date of [...new Set(dailyItems.map((x) => x.fcstDate))].sort()) {
		const rows = dailyItems.filter((x) => x.fcstDate === date);
		const select = (c) => rows.filter((x) => x.category === c).map((x) => number(x.fcstValue)).filter((v) => v !== null);
		const mins = select("TMN"), maxs = select("TMX"), pops = select("POP");
		daily.push({
			date,
			min: mins.length ? Math.min(...mins) : null,
			max: maxs.length ? Math.max(...maxs) : null,
			pop: pops.length ? Math.max(...pops) : null
		});
	}
	const data = {
		fetchedAt: now.toISOString(),
		grid,
		current: values,
		observedAt: current.source.base,
		hours: all.filter((h) => Date.parse(h.at) >= now.getTime() - 36e5),
		daily: daily.filter((d) => d.date >= stamp(kst(now))),
		sources: {
			current: current.source,
			ultra: ultra.source,
			forecast: forecast.source,
			air: activeAirResult.source,
			airForecast: airForecastResult.source,
			high: highResult.source
		},
		air: airHistory[0] ?? null,
		airHistory,
		airForecasts: normalizeForecasts(airForecastResult.items, searchDate),
		highForecasts: normalizeHigh(highResult.items, searchDate),
		airStation: {
			name: activeStation,
			...AIR_STATIONS[activeStation],
			requestedName: station,
			fallbackReason
		},
		notices: []
	};
	data.notices = advice(data, now);
	data.notices = combinedAdvice(data, now);
	return data;
}
//#endregion
//#region src/run.ts
var path = resolve(process.env.DATA_FILE || "web/data.json"), lock = path + ".lock";
mkdirSync(dirname(path), { recursive: true });
var fd;
try {
	fd = openSync(lock, "wx");
} catch {
	console.error("다른 수집 작업이 실행 중입니다. 중복 실행을 중지합니다.");
	process.exit(1);
}
try {
	const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
	if (previous !== null && (!Array.isArray(previous.feeds) || previous.feeds.length !== 8)) throw Error("기존 data.json 형식 확인 필요");
	hydrate(previous?._state);
	const nativeFetch = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (!["www.safetydata.go.kr", "apis.data.go.kr"].includes(url.hostname) || url.protocol !== "https:") throw Error("허용되지 않은 자료 제공기관");
		if (url.hostname === "apis.data.go.kr") {
			const key = `provider:${url.pathname}:${kstDay()}`;
			if (!(await DB.prepare("INSERT INTO api_usage(id,calls) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET calls=calls+1 WHERE api_usage.calls<100").bind(key).run()).meta.changes) throw Error("오늘 호출한도 도달 · 저장자료 유지");
		}
		if (process.env.COLLECTOR_TEST_FAILURE === "1") throw Error("테스트 제공기관 연결 실패");
		return nativeFetch(input, {
			...init,
			redirect: "error"
		});
	};
	await collectAll();
	await collectWarnings().catch(() => console.warn("기상특보 수집 지연 · 기존 자료 유지"));
	let weather = previous?.weather ?? null;
	const now = Date.now();
	if ((await DB.prepare("INSERT INTO collection_state(id,next_due,lease_until,last_started) VALUES('weather',0,?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,last_started=excluded.last_started WHERE collection_state.lease_until<=? AND collection_state.next_due<=?").bind(now + 9e4, now, now, now).run()).meta.changes) {
		let error = null;
		try {
			const fresh = await collectWeather({
				id: "city",
				name: "의정부시청",
				nx: 61,
				ny: 130
			});
			const fields = {
				current: ["current", "observedAt"],
				ultra: [],
				forecast: ["daily"],
				air: [
					"air",
					"airHistory",
					"airStation"
				],
				airForecast: ["airForecasts"],
				high: ["highForecasts"]
			};
			const failed = Object.entries(fresh.sources).filter(([, v]) => !v.ok).map(([k]) => k);
			for (const source of failed) if (weather) for (const key of fields[source] ?? []) fresh[key] = weather[key];
			if (!fresh.sources.forecast.ok && !fresh.sources.ultra.ok && weather) fresh.hours = weather.hours;
			if (fresh.sources.current.ok || fresh.sources.forecast.ok || fresh.sources.ultra.ok || fresh.sources.air.ok) {
				fresh.storage = {
					savedAt: (/* @__PURE__ */ new Date()).toISOString(),
					failedSources: failed
				};
				weather = fresh;
			}
			if (failed.some((k) => [
				"current",
				"ultra",
				"forecast",
				"air"
			].includes(k))) error = "기상·대기질 일부 수집 지연 · 마지막 정상자료 유지";
		} catch {
			error = "기상·대기질 수집 지연 · 마지막 정상자료 유지";
		}
		await DB.prepare("UPDATE collection_state SET lease_until=0,next_due=?,last_finished=?,last_error=? WHERE id='weather'").bind(Date.now() + (error ? 36e5 : 18e5), Date.now(), error).run();
	}
	const warnings = await readWarnings();
	if (weather && warnings) weather.warnings = warnings;
	const situation = await loadSituation();
	situation.warnings = warnings ?? previous?.warnings ?? null;
	situation.weather = weather;
	situation.sharedError = null;
	const state = dump();
	const newest = Math.max(0, ...situation.feeds.map((f) => Date.parse(f.savedAt ?? "") || 0), Date.parse(warnings?.collectedAt ?? "") || 0, Date.parse(weather?.storage?.savedAt ?? "") || 0);
	situation.at = new Date(newest).toISOString();
	const result = {
		...situation,
		_state: state,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	const serialized = JSON.stringify(result);
	for (const [name, value] of Object.entries(process.env)) if (name.endsWith("_KEY") && value && value.length >= 8 && (serialized.includes(value) || serialized.includes(encodeURIComponent(value)))) throw Error("인증정보 포함 여부 확인 필요 · 저장 중지");
	const tmp = path + ".tmp";
	writeFileSync(tmp, serialized + "\n", { mode: 420 });
	renameSync(tmp, path);
	const missing = FEEDS.filter((f) => !env[f.key]).map((f) => f.id);
	if (missing.length) console.warn("미설정 항목: " + missing.join(", "));
	const failures = situation.feeds.filter((f) => f.error).map((f) => f.id);
	console.log(JSON.stringify({
		savedAt: result.generatedAt,
		feeds: situation.feeds.map((f) => ({
			id: f.id,
			savedAt: f.savedAt,
			calls: f.calls,
			error: f.error
		})),
		weatherSavedAt: weather?.storage?.savedAt ?? null,
		warningsSavedAt: warnings?.collectedAt ?? null
	}));
	if (failures.length || missing.length || warnings?.error || !weather?.sources?.current?.ok || !weather?.sources?.air?.ok) console.warn("::warning::일부 제공기관 수집 또는 설정 확인 필요. 마지막 정상자료를 보존했습니다.");
} catch {
	console.error("::error::수집 상태 또는 저장 검증 실패. 기존 data.json을 유지합니다.");
	process.exitCode = 1;
} finally {
	closeSync(fd);
	unlinkSync(lock);
}
//#endregion
export {};
