import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 연결
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // index.html 위치

const requestQueue = [];

async function processQueue() {
  if (requestQueue.length === 0) return;

  const { prefix, count, res, modeLabel, week, timeout } = requestQueue[0];
  const prefixKey = prefix.endsWith("-") ? prefix : prefix + "-";

  try {
    console.log("📥 [REQ] 바코드 요청 받음 (큐)");
    console.log(" └─ Prefix:", prefix);
    console.log(" └─ Mode:", modeLabel);
    console.log(" └─ Count:", count);
    console.log(" └─ Week:", week);

    const { data, error } = await supabase
      .from("barcode_sequence_v2")
      .select("*")
      .eq("id", prefix)
      .eq("week", week)
      .eq("mode", modeLabel)
      .order("daynightnum", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("🧨 Supabase SELECT 오류:", error);
      res.status(500).json({ error: "DB 조회 실패" });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    if (!data) {
      const dayNightNum = modeLabel === "A" ? 0 : 5;
      const insert = await supabase
        .from("barcode_sequence_v2")
        .insert([{
          id: prefix,
          week,
          mode: modeLabel,
          daynightnum: dayNightNum,
          last_number: count,
          updated_at: new Date().toISOString()
        }]);

      if (insert.error) {
        console.error("💥 신규 row 생성 실패:", insert.error);
        res.status(500).json({ error: "row 생성 실패" });
        requestQueue.shift();
        clearTimeout(timeout);
        processQueue();
        return;
      }

      const barcodes = Array.from({ length: count }, (_, i) => {
        return `${prefix}-${week}${dayNightNum}-${i + 1}`;
      });

      console.log("✅ 신규 바코드 생성:", barcodes);
      res.json({ barcodes });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    let { daynightnum, last_number } = data;
    const dnMax = modeLabel === "A" ? 4 : 9;

    if (last_number + count <= 999) {
      const update = await supabase
        .from("barcode_sequence_v2")
        .update({
          last_number: last_number + count,
          updated_at: new Date().toISOString()
        })
        .eq("id", prefix)
        .eq("week", week)
        .eq("mode", modeLabel)
        .eq("daynightnum", daynightnum);

      if (update.error) {
        console.error("💥 UPDATE 실패:", update.error);
        res.status(500).json({ error: "바코드 갱신 실패" });
        requestQueue.shift();
        clearTimeout(timeout);
        processQueue();
        return;
      }

      const barcodes = Array.from({ length: count }, (_, i) => {
        return `${prefix}-${week}${daynightnum}-${last_number + i + 1}`;
      });

      console.log("✅ 이어서 바코드 생성:", barcodes);
      res.json({ barcodes });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    const nextDN = daynightnum + 1;
    if (nextDN > dnMax) {
      console.error("🛑 주야코드 초과! 더 이상 생성 불가");
      res.status(409).json({ error: "주야코드 초과" });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    const { data: nextRow } = await supabase
      .from("barcode_sequence_v2")
      .select("*")
      .eq("id", prefix)
      .eq("week", week)
      .eq("mode", modeLabel)
      .eq("daynightnum", nextDN)
      .maybeSingle();

    const newStartSerial = 1;
    const newLastNumber = count;

    const { error: upsertErr } = await supabase
      .from("barcode_sequence_v2")
      .upsert({
        id: prefix,
        week,
        mode: modeLabel,
        daynightnum: nextDN,
        last_number: newLastNumber,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "id,week,mode,daynightnum"
      });

    if (upsertErr) {
      console.error("💥 upsert 실패:", upsertErr);
      res.status(500).json({ error: "upsert 실패" });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    const barcodes = Array.from({ length: count }, (_, i) => {
      return `${prefix}-${week}${nextDN}-${newStartSerial + i}`;
    });

    console.log("✅ 증가된 주야코드로 바코드 생성:", barcodes);
    res.json({ barcodes });
  } catch (e) {
    console.error("💣 전체 실패:", e);
    res.status(500).json({ error: "서버 내부 오류" });
  } finally {
    clearTimeout(requestQueue[0].timeout);
    requestQueue.shift();
    processQueue();
  }
}

app.post("/dev-next-barcode", async (req, res) => {
  const { prefix, mode, count, week } = req.body;
  const timeout = setTimeout(() => {
    res.status(408).json({ error: "⏱️ 요청 타임아웃" });
    requestQueue.shift();
    processQueue();
  }, 10000);

  requestQueue.push({ prefix, count, res, modeLabel: mode, week, timeout });
  if (requestQueue.length === 1) {
    processQueue();
  }
});


// 바코드 API
app.post("/dev-next-barcode", async (req, res) => {
  const { prefix, mode, count, week, idParts } = req.body;

  console.log("📥 [REQ] 바코드 요청 받음");
  console.log(" └─ Prefix:", prefix);
  console.log(" └─ Mode:", mode);
  console.log(" └─ Count:", count);
  console.log(" └─ Week:", week);
  console.log(" └─ ID Parts:", idParts);

  try {
    let modeLabel = mode; // A or B
    let dayNightNum = null;

    // 1. 현재 row 조회
    const { data, error } = await supabase
      .from("barcode_sequence_v2")
      .select("*")
      .eq("id", prefix)
      .eq("week", week)
      .eq("mode", modeLabel)
      .order("daynightnum", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("🧨 Supabase SELECT 오류:", error);
      return res.status(500).json({ error: "DB 조회 실패" });
    }

    if (!data) {
      // row가 아예 없을 경우
      dayNightNum = modeLabel === "A" ? 0 : 5;
      const insert = await supabase
        .from("barcode_sequence_v2")
        .insert([{
          id: prefix,
          week,
          mode: modeLabel,
          daynightnum: dayNightNum,
          last_number: count,
          updated_at: new Date().toISOString()
        }]);

      if (insert.error) {
        console.error("💥 신규 row 생성 실패:", insert.error);
        return res.status(500).json({ error: "row 생성 실패" });
      }

      const barcodes = Array.from({ length: count }, (_, i) => {
        return `${prefix}-${week}${dayNightNum}-${i + 1}`;
      });

      console.log("✅ 신규 바코드 생성:", barcodes);
      return res.json({ barcodes });
    }

    // row 존재 시
    let { daynightnum, last_number } = data;
    const dnMax = modeLabel === "A" ? 4 : 9;

    if (last_number + count <= 999) {
      // 바로 이어서 사용 가능
      const update = await supabase
        .from("barcode_sequence_v2")
        .update({
          last_number: last_number + count,
          updated_at: new Date().toISOString()
        })
        .eq("id", prefix)
        .eq("week", week)
        .eq("mode", modeLabel)
        .eq("daynightnum", daynightnum);

      if (update.error) {
        console.error("💥 UPDATE 실패:", update.error);
        return res.status(500).json({ error: "바코드 갱신 실패" });
      }

      const barcodes = Array.from({ length: count }, (_, i) => {
        return `${prefix}-${week}${daynightnum}-${last_number + i + 1}`;
      });

      console.log("✅ 이어서 바코드 생성:", barcodes);
      return res.json({ barcodes });

    } else {
      // 넘치므로 다음 daynightnum 사용
      const nextDN = daynightnum + 1;

      if (nextDN > dnMax) {
        console.error("🛑 주야코드 초과! 더 이상 생성 불가");
        return res.status(409).json({ error: "주야코드 초과" });
      }

// nextDN 존재 여부 확인
const { data: nextRow } = await supabase
  .from("barcode_sequence_v2")
  .select("*")
  .eq("id", prefix)
  .eq("week", week)
  .eq("mode", modeLabel)
  .eq("daynightnum", nextDN)
  .maybeSingle(); // <= .single() 대신 maybeSingle() 권장

// ✨ serial은 항상 1부터 시작
const newStartSerial = 1;
const newLastNumber = count;

// upsert
const { error: upsertErr } = await supabase
  .from("barcode_sequence_v2")
  .upsert({
    id: prefix,
    week,
    mode: modeLabel,
    daynightnum: nextDN,
    last_number: newLastNumber,
    updated_at: new Date().toISOString()
  }, {
    onConflict: "id,week,mode,daynightnum"
  });

if (upsertErr) {
  console.error("💥 upsert 실패:", upsertErr);
  return res.status(500).json({ error: "upsert 실패" });
}

// ✅ 바코드 생성
const barcodes = Array.from({ length: count }, (_, i) => {
  return `${prefix}-${week}${nextDN}-${newStartSerial + i}`;
});

console.log("✅ 증가된 주야코드로 바코드 생성:", barcodes);
return res.json({ barcodes });
    }

  } catch (e) {
    console.error("💣 전체 실패:", e);
    res.status(500).json({ error: "서버 내부 오류" });
  }
});


// 설정 저장
import fs from "fs-extra";
import path from "path";
const SETTINGS_FILE = path.join(process.cwd(), "load-settings.json");

app.post("/save-settings", async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: "Invalid body" });

    await fs.writeJson(SETTINGS_FILE, data, { spaces: 2 });
    console.log("💾 설정 저장 완료");

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ 설정 저장 실패:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/load-settings", async (req, res) => {
  try {
    const data = await fs.readJson(SETTINGS_FILE);
    res.json(data);
  } catch (err) {
    console.warn("⚠️ 설정 로드 실패 (기본값 사용)");
    res.json({});
  }
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Supabase 바코드 서버 실행 중 - 포트 ${PORT}`);
});