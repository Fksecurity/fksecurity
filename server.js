import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import fs from "fs-extra";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 연결
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const requestQueue = [];

async function processQueue() {
  if (requestQueue.length === 0) return;

  const { prefix, count, res, modeLabel, week, timeout } = requestQueue[0];

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

    const available = 999 - last_number;
    const nextDN = daynightnum + 1;
    if (nextDN > dnMax) {
      console.error("🛑 주야코드 초과! 더 이상 생성 불가");
      res.status(409).json({ error: "주야코드 초과" });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    const currentBarcodes = Array.from({ length: available }, (_, i) => {
      return `${prefix}-${week}${daynightnum}-${last_number + i + 1}`;
    });

    const newStartSerial = 1;
    const newLastNumber = count - available;

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

    const nextBarcodes = Array.from({ length: newLastNumber }, (_, i) => {
      return `${prefix}-${week}${nextDN}-${newStartSerial + i}`;
    });

    const barcodes = [...currentBarcodes, ...nextBarcodes];
    console.log("✅ 나눠서 바코드 생성:", barcodes);
    res.json({ barcodes });

  } catch (e) {
    console.error("💣 전체 실패:", e);
    res.status(500).json({ error: "서버 내부 오류" });
  } finally {
    const current = requestQueue.shift();
    if (current?.timeout) clearTimeout(current.timeout);
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

app.listen(PORT, () => {
  console.log(`✅ Supabase 바코드 서버 실행 중 - 포트 ${PORT}`);
});
