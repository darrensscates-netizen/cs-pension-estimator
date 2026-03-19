import { useState } from "react";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const G = {
  green:"#00703c", greenDark:"#005a30", greenLight:"#cce2d8",
  greenBorder:"#00703c", focus:"#ffdd00", text:"#0b0c0c",
  textSec:"#505a5f", border:"#b1b4b6", borderDark:"#0b0c0c",
  bg:"#f3f2f0", white:"#ffffff", error:"#d4351c",
  warning:"#f47738", link:"#1d70b8",
  font:"'Arial','Helvetica Neue',Helvetica,sans-serif",
};

// ─── SCHEME RULES ─────────────────────────────────────────────────────────────
const SCHEME_INFO = {
  classic:     { label:"Classic",      npa:60, minAge:50, type:"final_salary" },
  classicplus: { label:"Classic Plus", npa:60, minAge:50, type:"final_salary" },
  premium:     { label:"Premium",      npa:60, minAge:50, type:"final_salary" },
  nuvos:       { label:"Nuvos",        npa:65, minAge:55, type:"care" },
  alpha:       { label:"Alpha",        npa:null, minAge:55, type:"care" },
};

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const CY = new Date().getFullYear();
const CM = new Date().getMonth(); // 0-indexed

// Convert {month, year} (month 1-12) to decimal years from epoch for arithmetic
function toDecimal(month, year){ return year + (month - 1) / 12; }

// Years between two {month,year} objects (positive = second is later)
function yearsBetween(from, to){
  return toDecimal(to.month, to.year) - toDecimal(from.month, from.year);
}

function getSPA(dob){
  if(!dob) return 67;
  const y = new Date(dob).getFullYear();
  return y < 1960 ? 65 : y < 1977 ? 66 : 67;
}
function getAlphaNPA(dob){ return Math.max(65, getSPA(dob)); }
function getNPA(scheme, dob){
  return scheme === "alpha" ? getAlphaNPA(dob) : (SCHEME_INFO[scheme]?.npa ?? 60);
}

// Per-scheme actuarial reduction factor given years early
function earlyFactor(scheme, yearsEarly){
  if(yearsEarly <= 0) return 1;
  if(scheme === "alpha") return Math.max(0, 1 - 0.04 * yearsEarly);
  // Classic / Premium / Nuvos: 5% first 3 years, 4% thereafter
  const y = Math.min(yearsEarly, 20);
  const r = y <= 3 ? y * 0.05 : 0.15 + (y - 3) * 0.04;
  return Math.max(0, 1 - r);
}

// Minimum pension age
function getMinAge(dob){
  if(!dob) return 55;
  const d = new Date(dob);
  // Joined before Apr 2006 — MPA 50; otherwise 55
  // We use DOB proxy: if born before 1956 they could have joined pre-2006 at 50
  return d.getFullYear() < 1956 ? 50 : 55;
}

const fmt = n => "£" + Math.round(n).toLocaleString("en-GB");
const fmtPct = n => (n * 100).toFixed(1) + "%";
const fmtYrs = n => {
  const y = Math.floor(Math.abs(n));
  const m = Math.round((Math.abs(n) - y) * 12);
  return `${y} yr${y !== 1 ? "s" : ""}${m > 0 ? ` ${m} mth${m !== 1 ? "s" : ""}` : ""}`;
};

// ─── PERIOD FACTORY ───────────────────────────────────────────────────────────
function makePeriod(type = "service"){
  return {
    id: Date.now() + Math.random(), type,
    // service
    scheme:"alpha",
    startMonth:"4", startYear:"",
    endMonth: String(CM + 1), endYear:"present",
    classicYears:"", salaryInputs:[],
    // break
    breakStartMonth:"1", breakStartYear:"",
    breakEndMonth:"1", breakEndYear:"",
    // transfer
    transferType:"club", transferScheme:"nuvos",
    serviceCredit:"", annualPensionValue:"",
  };
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [disclaimerScrolled, setDisclaimerScrolled] = useState(false);
  const [disclaimerChecked,  setDisclaimerChecked]  = useState(false);

  const [step,   setStep]   = useState(0);
  const [errors, setErrors] = useState({});

  // Step 0
  const [dob,  setDob]  = useState("");
  const [name, setName] = useState("");

  // Step 1
  const [periods, setPeriods] = useState([makePeriod("service")]);

  // Step 2
  const [finalSalary, setFinalSalary] = useState("");

  // Step 3 — retirement
  const [retMonth,  setRetMonth]  = useState(String(CM + 1));
  const [retYear,   setRetYear]   = useState("");
  const [basis,     setBasis]     = useState("normal");
  // voluntary retirement CSCS
  const [vrSeveranceMonths, setVrSeveranceMonths] = useState("");
  // commutation
  const [commute,    setCommute]    = useState(false);
  const [commuteAmt, setCommuteAmt] = useState("");

  const [results, setResults] = useState(null);

  // ── derived ──
  const servicePeriods  = periods.filter(p => p.type === "service");
  const breakPeriods    = periods.filter(p => p.type === "break");
  const transferPeriods = periods.filter(p => p.type === "transfer");

  const hasFinalSalary = servicePeriods.some(p => ["classic","classicplus","premium"].includes(p.scheme));
  const carePeriods    = servicePeriods.filter(p => ["nuvos","alpha"].includes(p.scheme) && getServiceMonths(p) > 0);
  const hasClubTransfer = transferPeriods.some(p => p.transferType === "club");

  // Longest break in decimal years
  const longestBreak = breakPeriods.reduce((max, b) => {
    if(!b.breakStartYear || !b.breakEndYear) return max;
    const yrs = yearsBetween(
      { month: parseInt(b.breakStartMonth), year: parseInt(b.breakStartYear) },
      { month: parseInt(b.breakEndMonth),   year: parseInt(b.breakEndYear) }
    );
    return Math.max(max, yrs);
  }, 0);
  const finalSalaryLinkLost = longestBreak >= 5;

  function getServiceMonths(p){
    if(!p.startYear) return 0;
    const sy = parseInt(p.startYear), sm = parseInt(p.startMonth) || 4;
    const ey = p.endYear === "present" ? CY  : (parseInt(p.endYear) || CY);
    const em = p.endYear === "present" ? CM + 1 : (parseInt(p.endMonth) || 1);
    return Math.max(0, (ey - sy) * 12 + (em - sm));
  }

  function getServiceYears(p){ return getServiceMonths(p) / 12; }

  function updatePeriod(id, field, val){
    setPeriods(ps => ps.map(p => {
      if(p.id !== id) return p;
      const up = { ...p, [field]: val };
      // Rebuild salaryInputs when date or scheme changes
      if(["scheme","startYear","startMonth","endYear","endMonth"].includes(field)){
        const months = getServiceMonths(up);
        const schemeYears = Math.ceil(months / 12);
        if(["nuvos","alpha"].includes(up.scheme)){
          const ex = p.salaryInputs || [];
          up.salaryInputs = Array.from({ length: schemeYears }, (_, i) => ex[i] ?? "");
        }
      }
      return up;
    }));
  }

  function updateSalaryInput(id, idx, val){
    setPeriods(ps => ps.map(p => {
      if(p.id !== id) return p;
      const arr = [...(p.salaryInputs || [])];
      arr[idx] = val;
      return { ...p, salaryInputs: arr };
    }));
  }

  function addPeriod(type){ setPeriods(ps => [...ps, makePeriod(type)]); }
  function removePeriod(id){ setPeriods(ps => ps.filter(p => p.id !== id)); }

  // ── validation ──
  function validate(){
    const e = {};
    if(step === 0){ if(!dob) e.dob = "Enter your date of birth"; }
    if(step === 1){
      periods.forEach((p, i) => {
        if(p.type === "service"){
          if(!p.startYear) e[`sy_${i}`] = "Enter a start year";
          if(p.scheme === "classicplus" && !p.classicYears) e[`cy_${i}`] = "Enter Classic years";
          if(getServiceMonths(p) <= 0 && p.startYear) e[`yr_${i}`] = "End date must be after start date";
        }
        if(p.type === "break"){
          if(!p.breakStartYear) e[`bs_${i}`] = "Enter break start year";
          if(!p.breakEndYear)   e[`be_${i}`] = "Enter break end year";
          if(p.breakStartYear && p.breakEndYear){
            const yrs = yearsBetween(
              { month:parseInt(p.breakStartMonth), year:parseInt(p.breakStartYear) },
              { month:parseInt(p.breakEndMonth),   year:parseInt(p.breakEndYear)   }
            );
            if(yrs <= 0) e[`be_${i}`] = "End must be after start";
          }
        }
        if(p.type === "transfer"){
          if(p.transferType === "club"    && !p.serviceCredit)      e[`tc_${i}`] = "Enter service credit in years";
          if(p.transferType === "nonclub" && !p.annualPensionValue) e[`tv_${i}`] = "Enter annual pension amount";
        }
      });
    }
    if(step === 2){
      if(hasFinalSalary && (!finalSalary || isNaN(finalSalary))) e.fs = "Enter your final pensionable salary";
      carePeriods.forEach(p => {
        const yrs = Math.ceil(getServiceMonths(p) / 12);
        Array.from({ length: yrs }, (_, i) => {
          if(!p.salaryInputs?.[i] || isNaN(p.salaryInputs[i])) e[`si_${p.id}_${i}`] = "Required";
        });
      });
    }
    if(step === 3){
      if(!retYear || isNaN(retYear)) e.ra = "Enter your intended retirement year";
    }
    return e;
  }

  function next(){
    const e = validate();
    if(Object.keys(e).length){ setErrors(e); return; }
    setErrors({});
    if(step === 3) compute();
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back(){
    setErrors({});
    setStep(s => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── compute ──
  function compute(){
    const fs   = parseFloat(finalSalary) || 0;
    const spa  = getSPA(dob);
    const aNPA = getAlphaNPA(dob);
    const retDate = { month: parseInt(retMonth), year: parseInt(retYear) };

    // DOB date object for age calc
    const dobDate = dob ? new Date(dob) : null;
    const retAgeDecimal = dobDate
      ? yearsBetween({ month: dobDate.getMonth() + 1, year: dobDate.getFullYear() }, retDate)
      : parseFloat(retYear) - (dobDate ? new Date(dob).getFullYear() : 0);

    const breakdown = [];

    // ── Service periods ──
    servicePeriods.forEach(p => {
      const months = getServiceMonths(p);
      if(months <= 0) return;
      const yrs = months / 12;
      const npa = getNPA(p.scheme, dob);

      // Years early = NPA minus retirement age (per scheme NPA)
      const yearsEarlyThisScheme = Math.max(0, npa - retAgeDecimal);
      const factor = (basis === "normal" || basis === "voluntary_retirement")
        ? earlyFactor(p.scheme, yearsEarlyThisScheme)
        : basis === "early" ? earlyFactor(p.scheme, yearsEarlyThisScheme)
        : 1; // ill-health lower/upper = no reduction

      let unreduced = 0, autoLump = 0;

      if(p.scheme === "classic"){
        unreduced = (fs * yrs) / 80;
        autoLump  = 0;
      } else if(p.scheme === "classicplus"){
        const cy = Math.min(parseFloat(p.classicYears) || 0, yrs);
        const py = yrs - cy;
        unreduced = (fs * cy) / 80 + (fs * py) / 60;
        autoLump  = 0;
      } else if(p.scheme === "premium"){
        unreduced = (fs * yrs) / 60;
      } else if(p.scheme === "nuvos" || p.scheme === "alpha"){
        // ── CPI revaluation model ──────────────────────────────────────────────
        // Each April 1st (scheme anniversary) the pot is revalued by CPI.
        // Formula per year: new_pot = (old_pot + year_accrual) × (1 + CPI)
        // For the final part-year (retirement mid-year): add raw accrual, no CPI applied
        // as CPI is only applied on April anniversaries.
        // We use 3% long-run CPI assumption throughout.
        //
        // salaryInputs[0] = first full scheme year, salaryInputs[N-1] = last full year
        // If retirement is mid-year, the last entry may cover a partial year.
        const CPI = 0.03;
        const rate = p.scheme === "nuvos" ? 0.023 : 0.0232;
        const inputs = p.salaryInputs || [];
        const totalMonths = months; // total months of service

        // Work out how many full April–March years there are and the partial remainder
        const fullYears = Math.floor(totalMonths / 12);
        const partMonths = totalMonths % 12; // leftover months in final part-year

        let pot = 0;
        // Process each full scheme year: (pot + accrual) × (1 + CPI)
        for(let i = 0; i < fullYears; i++){
          const sal = parseFloat(inputs[i]) || 0;
          pot = (pot + sal * rate) * (1 + CPI);
        }
        // Add part-year accrual (pro-rated, no CPI applied — CPI only at April anniversaries)
        if(partMonths > 0){
          const partSal = parseFloat(inputs[fullYears]) || 0;
          const partAccrual = partSal * rate * (partMonths / 12);
          pot += partAccrual; // no CPI on final part-year
        }
        unreduced = pot;
      }

      // Ill-health upper tier: add enhancement
      let enhancement = 0;
      if(basis === "ill_health_upper"){
        const avgAnnual = yrs > 0 ? unreduced / yrs : 0;
        enhancement = avgAnnual * Math.max(0, npa - retAgeDecimal);
      }

      const reduced = (unreduced + enhancement) * factor;

      breakdown.push({
        label: `${SCHEME_INFO[p.scheme]?.label} (${MONTHS[parseInt(p.startMonth)-1]} ${p.startYear} – ${p.endYear==="present"?"present":`${MONTHS[parseInt(p.endMonth)-1]} ${p.endYear}`})`,
        scheme: p.scheme,
        years: yrs, unreduced, autoLump, reduced, factor,
        yearsEarly: yearsEarlyThisScheme, npa, enhancement,
        isTransfer: false,
        periodStartDecimal: toDecimal(parseInt(p.startMonth), parseInt(p.startYear)),
      });
    });

    // ── Transfer periods ──
    transferPeriods.forEach(p => {
      const npa = getNPA(p.transferScheme, dob);
      const yearsEarlyThisScheme = Math.max(0, npa - retAgeDecimal);
      const factor = (basis === "normal" || basis === "voluntary_retirement" || basis === "early")
        ? earlyFactor(p.transferScheme, yearsEarlyThisScheme) : 1;

      if(p.transferType === "club"){
        const sc = parseFloat(p.serviceCredit) || 0;
        if(sc === 0) return;
        const unreduced = (fs * sc) / 60;
        breakdown.push({
          label: `Club Transfer In → ${SCHEME_INFO[p.transferScheme]?.label} (${sc} yr credit)`,
          scheme: p.transferScheme, years: sc,
          unreduced, autoLump: 0, reduced: unreduced * factor,
          factor, yearsEarly: yearsEarlyThisScheme, npa, enhancement: 0, isTransfer: true,
        });
      } else {
        const pv = parseFloat(p.annualPensionValue) || 0;
        if(pv === 0) return;
        breakdown.push({
          label: `Non-Club Transfer → ${SCHEME_INFO[p.transferScheme]?.label} (fixed)`,
          scheme: p.transferScheme, years: null,
          unreduced: pv, autoLump: 0, reduced: pv * factor,
          factor, yearsEarly: yearsEarlyThisScheme, npa, enhancement: 0, isTransfer: true,
        });
      }
    });

    const totalUnreduced = breakdown.reduce((s, b) => s + b.unreduced, 0);
    const totalReduced   = breakdown.reduce((s, b) => s + b.reduced,   0);
    const totalAutoLump  = breakdown.reduce((s, b) => s + b.autoLump,  0);

    // Commutation
    let commuteGiveUp = 0, lumpFromCommute = 0;
    if(commute && commuteAmt && !isNaN(commuteAmt)){
      commuteGiveUp   = Math.min(parseFloat(commuteAmt), totalReduced);
      lumpFromCommute = commuteGiveUp * 12;
    }
    const finalPension = totalReduced - commuteGiveUp;

    // ── Voluntary retirement CSCS — compensation & buy-out ──────────────────
    // Key rule (CSCS 2010):
    // - Compensation is based on POST-LAST-BREAK continuous service only (1 month/yr, max 21 months)
    // - Employer buy-out subsidy (VR only) applies ONLY to the actuarial reduction on post-last-break pension
    // - Pre-break deferred pension can be taken early but is always actuarially reduced — no buy-out applies
    let vrCompensation = 0;
    let vrPostBreakYrs = 0, vrPreBreakYrs = 0;
    let vrPostBreakUnreduced = 0, vrPreBreakUnreduced = 0;
    let vrPostBreakReduced = 0, vrPreBreakReduced = 0;
    let vrPostBreakReduction = 0, vrPreBreakReduction = 0;
    let vrBuyOutCostPostBreak = 0;
    let vrPensionIfFullBuyOut = 0;

    if(basis === "voluntary_retirement"){
      // Find the last break end date (if any)
      let lastBreakEnd = null;
      breakPeriods.forEach(b => {
        if(!b.breakEndYear) return;
        const bd = toDecimal(parseInt(b.breakEndMonth), parseInt(b.breakEndYear));
        if(!lastBreakEnd || bd > lastBreakEnd) lastBreakEnd = bd;
      });

      // Split service breakdown into pre/post last break
      breakdown.forEach(b => {
        if(b.isTransfer) return;
        const isPostBreak = !lastBreakEnd || (b.periodStartDecimal >= lastBreakEnd);
        if(isPostBreak){
          vrPostBreakYrs       += b.years || 0;
          vrPostBreakUnreduced += b.unreduced;
          vrPostBreakReduced   += b.reduced;
        } else {
          vrPreBreakYrs        += b.years || 0;
          vrPreBreakUnreduced  += b.unreduced;
          vrPreBreakReduced    += b.reduced;
        }
      });

      // Sum of all transfer-in reduced amounts — transfers always stay reduced, no buy-out
      const vrTransfersReduced = breakdown
        .filter(b => b.isTransfer)
        .reduce((s, b) => s + b.reduced, 0);

      vrPostBreakReduction = vrPostBreakUnreduced - vrPostBreakReduced;
      vrPreBreakReduction  = vrPreBreakUnreduced  - vrPreBreakReduced;

      // CSCS compensation = 1 month salary × post-break continuous years, max 21 months
      const capMonths = Math.min(21, Math.floor(vrPostBreakYrs));
      vrCompensation = (fs / 12) * capMonths;

      // Buy-out cost on POST-BREAK reduction only (~capitalisation factor 20)
      vrBuyOutCostPostBreak = vrPostBreakReduction * 20;

      // Full buy-out pension:
      //   post-break service → unreduced (buy-out applied)
      //   pre-break deferred pension → reduced (no buy-out available)
      //   transfers → reduced (no buy-out available)
      vrPensionIfFullBuyOut = vrPostBreakUnreduced + vrPreBreakReduced + vrTransfersReduced;
    }

    setResults({
      finalPension, monthly: finalPension / 12,
      totalLump: lumpFromCommute,
      totalAutoLump: 0, lumpFromCommute, commuteGiveUp,
      totalUnreduced, totalReduced,
      breakdown, retAgeDecimal: retAgeDecimal.toFixed(1),
      spa, aNPA, retDate, basis,
      finalSalaryLinkLost, longestBreak,
      hasBreaks: breakPeriods.length > 0,
      hasTransfers: transferPeriods.length > 0,
      // VR fields
      vrCompensation, vrPostBreakYrs, vrPreBreakYrs,
      vrPostBreakUnreduced, vrPreBreakUnreduced,
      vrPostBreakReduced, vrPreBreakReduced,
      vrPostBreakReduction, vrPreBreakReduction,
      vrBuyOutCostPostBreak, vrPensionIfFullBuyOut,
      vrTransfersReduced,
      hasPreBreakService: vrPreBreakYrs > 0,
      minAge: getMinAge(dob),
    });
  }

  function yearLabel(period, idx){
    const sm = parseInt(period.startMonth) || 4;
    const sy = parseInt(period.startYear) || CY;
    // Scheme years run April–March
    const startY = sy + Math.floor((sm - 4 + idx * 12) / 12);
    return `${startY}–${startY + 1}`;
  }

  const stepTitles = ["About you","Career history","Salary details","Retirement plans","Your estimate"];

  // ── DISCLAIMER GATE ──────────────────────────────────────────────────────────
  if(!disclaimerAccepted){
    return(
      <div style={{fontFamily:G.font,background:G.bg,minHeight:"100vh",color:G.text}}>
        <div style={{background:G.green}}>
          <div style={{maxWidth:960,margin:"0 auto",padding:"0 30px"}}>
            <div style={{padding:"14px 0 10px",display:"flex",alignItems:"center",gap:14,borderBottom:"1px solid rgba(255,255,255,0.3)"}}>
              <div style={{background:"white",color:G.green,fontWeight:"900",fontSize:15,padding:"4px 8px"}}>CS</div>
              <span style={{color:"white",fontSize:18,fontWeight:"bold"}}>Civil Service Pension Estimator</span>
            </div>
            <div style={{padding:"8px 0 12px",fontSize:14,color:"rgba(255,255,255,0.85)"}}>Independent informal tool — not an official Civil Service Pensions service</div>
          </div>
        </div>
        <div style={{maxWidth:680,margin:"0 auto",padding:"40px 30px 80px"}}>
          <div style={{background:"#fff4e5",border:`4px solid ${G.warning}`,padding:"16px 20px",marginBottom:24}}>
            <strong style={{fontSize:17,color:G.error}}>⚠ IMPORTANT — Please read before continuing</strong>
            <p style={{margin:"8px 0 0",fontWeight:"bold",color:G.error,fontSize:14}}>THIS IS NOT AN OFFICIAL GOVERNMENT OR CIVIL SERVICE PENSIONS SERVICE. NOTHING HERE CONSTITUTES FINANCIAL, PENSION OR LEGAL ADVICE.</p>
          </div>
          <h1 style={{fontSize:28,fontWeight:"bold",borderBottom:`4px solid ${G.green}`,paddingBottom:12,marginBottom:20}}>Important Disclaimer and Terms of Use</h1>
          <div onScroll={e=>{const el=e.target;if(el.scrollHeight-el.scrollTop-el.clientHeight<30)setDisclaimerScrolled(true);}}
            style={{height:380,overflowY:"scroll",border:`2px solid ${G.border}`,background:G.white,padding:"20px 24px",marginBottom:20,fontSize:14,lineHeight:1.8}}>
            <h2 style={{fontSize:17,fontWeight:"bold",marginTop:0}}>1. Nature of this tool</h2>
            <p>This Civil Service Pension Estimator is an <strong>independent, informal estimation tool</strong>. It is not affiliated with, endorsed by, or connected to HM Government, the Cabinet Office, Civil Service Pensions, the Scheme Administrator (Capita), or any other official body.</p>
            <h2 style={{fontSize:17,fontWeight:"bold"}}>2. Not financial, pension or legal advice</h2>
            <p>Nothing produced by this tool constitutes financial advice, pension advice, legal advice, actuarial advice, or any other form of professional advice. Do not make any retirement, financial or employment decision based solely or primarily on these outputs. Obtain a formal benefit statement from the Scheme Administrator and, where appropriate, take independent regulated financial advice from an FCA-authorised adviser.</p>
            <h2 style={{fontSize:17,fontWeight:"bold"}}>3. Accuracy and limitations</h2>
            <p>This tool does <strong>not</strong> account for: the McCloud/2015 Remedy · Added Pension or AVCs · Exact CPI uprating on deferred pensions · Pension sharing orders · Abatement · EPA/EEPA arrangements · Exact GAD actuarial factors · Future changes to State Pension Age · The Civil Service Compensation Scheme buy-out cost (which requires GAD factors) · Individual circumstances affecting entitlement. Early retirement reductions are indicative only.</p>
            <h2 style={{fontSize:17,fontWeight:"bold"}}>4. No liability</h2>
            <p>To the fullest extent permitted by law, the operator accepts <strong>no liability whatsoever</strong> for any loss, damage or expense arising from use of or reliance on this tool.</p>
            <h2 style={{fontSize:17,fontWeight:"bold"}}>5. No data collection</h2>
            <p>This tool runs entirely in your browser. No personal data is transmitted to any server, stored, or shared with any third party.</p>
            <h2 style={{fontSize:17,fontWeight:"bold"}}>6. Official sources</h2>
            <p>For an official estimate use the <strong>Retirement Modeller</strong> at <strong>www.civilservicepensionscheme.org.uk</strong>. For regulated financial advice visit <strong>www.moneyhelper.org.uk</strong>.</p>
            <p style={{fontStyle:"italic",color:G.textSec,marginTop:24,borderTop:`1px solid ${G.border}`,paddingTop:16}}>Scroll to the bottom of this disclaimer to continue. By ticking the box and clicking "I understand and agree" you confirm you have read and understood these terms.</p>
          </div>
          {!disclaimerScrolled && <p style={{color:G.textSec,fontSize:14,fontStyle:"italic"}}>↑ Please scroll to the bottom of the disclaimer above to continue.</p>}
          {disclaimerScrolled && <>
            <label style={{display:"flex",gap:12,alignItems:"flex-start",cursor:"pointer",marginBottom:20,background:disclaimerChecked?G.greenLight:G.white,border:`2px solid ${disclaimerChecked?G.greenBorder:G.border}`,padding:"14px 16px"}}>
              <input type="checkbox" checked={disclaimerChecked} onChange={e=>setDisclaimerChecked(e.target.checked)} style={{accentColor:G.green,width:22,height:22,flexShrink:0,marginTop:2}}/>
              <span style={{fontSize:15,lineHeight:1.6}}><strong>I have read and understood the disclaimer.</strong> I confirm I will not treat any output as financial, pension, legal or other professional advice, and understand this is not an official Civil Service Pensions service.</span>
            </label>
            <button onClick={()=>{if(disclaimerChecked)setDisclaimerAccepted(true);}} disabled={!disclaimerChecked}
              style={{background:disclaimerChecked?G.green:"#b1b4b6",color:"white",border:"none",padding:"14px 28px",fontSize:17,fontWeight:"bold",fontFamily:G.font,cursor:disclaimerChecked?"pointer":"not-allowed"}}>
              I understand and agree — continue to the estimator
            </button>
          </>}
        </div>
        <Footer/>
      </div>
    );
  }

  // ── MAIN APP ─────────────────────────────────────────────────────────────────
  return(
    <div style={{fontFamily:G.font,background:G.bg,minHeight:"100vh",color:G.text}}>
      <div style={{background:G.green}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 30px"}}>
          <div style={{padding:"14px 0 10px",display:"flex",alignItems:"center",gap:14,borderBottom:"1px solid rgba(255,255,255,0.3)"}}>
            <div style={{background:"white",color:G.green,fontWeight:"900",fontSize:15,padding:"4px 8px"}}>CS</div>
            <span style={{color:"white",fontSize:18,fontWeight:"bold"}}>Civil Service Pension Estimator</span>
          </div>
          <div style={{padding:"8px 0 12px",fontSize:14,color:"rgba(255,255,255,0.85)"}}>Informal guide to your Civil Service pension — not an official calculation</div>
        </div>
      </div>

      {/* PERSISTENT BANNER */}
      <div style={{background:"#fff4e5",borderBottom:`3px solid ${G.warning}`,padding:"10px 30px"}}>
        <div style={{maxWidth:960,margin:"0 auto",fontSize:13,color:"#594000",display:"flex",gap:10,flexWrap:"wrap"}}>
          <span style={{fontWeight:"bold",whiteSpace:"nowrap"}}>⚠ Not an official service.</span>
          <span>Estimates only — not financial, pension or legal advice. For an official calculation use the <strong>Civil Service Pension Portal</strong>. Consult a regulated financial adviser before making retirement decisions.</span>
        </div>
      </div>

      {/* STEP NAV */}
      <div style={{background:G.greenDark,borderBottom:`4px solid ${G.green}`}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 30px",display:"flex",overflowX:"auto"}}>
          {stepTitles.map((t,i)=>(
            <div key={i} style={{padding:"10px 16px 8px",fontSize:13,whiteSpace:"nowrap",
              fontWeight:i===step?"bold":"normal",
              color:i===step?G.focus:i<step?G.greenLight:"rgba(255,255,255,0.45)",
              borderBottom:i===step?`4px solid ${G.focus}`:"4px solid transparent",marginBottom:-4}}>
              {i<step?"✓ ":`${i+1}. `}{t}
            </div>
          ))}
        </div>
      </div>

      <div style={{maxWidth:680,margin:"0 auto",padding:"40px 30px 80px"}}>

        {/* ══ STEP 0 ══ */}
        {step===0&&<>
          <H1>About you</H1>
          <GovHint>We use your date of birth to determine your Normal Pension Age for each scheme and your State Pension Age.</GovHint>
          <GovField label="Full name (optional)" id="name" hint="Used only to personalise your results">
            <GovInput id="name" value={name} onChange={e=>setName(e.target.value)} width={300} placeholder="e.g. Jane Smith"/>
          </GovField>
          <GovField label="Date of birth" id="dob" error={errors.dob} required>
            <GovInput id="dob" type="date" value={dob} onChange={e=>setDob(e.target.value)} width={220} error={!!errors.dob}/>
          </GovField>
          {dob&&<GovInset>
            <strong>Your Normal Pension Ages:</strong>
            <ul style={{margin:"6px 0 0",paddingLeft:20,lineHeight:1.8}}>
              <li>Classic / Premium: <strong>60</strong></li>
              <li>Nuvos: <strong>65</strong></li>
              <li>Alpha: <strong>{getAlphaNPA(dob)}</strong> (greater of State Pension Age {getSPA(dob)} or 65)</li>
            </ul>
          </GovInset>}
          <GovDetails summary="Which scheme am I in?">
            <SchemeTable rows={[
              ["Before 1 October 2002","Classic","1/80th final salary per year. NPA 60. Pension can be commuted for lump sum at £12/£1."],
              ["Oct 2002 – Jul 2007 (new entrant)","Premium","1/60th final salary per year. NPA 60. Pension can be commuted for lump sum at £12/£1."],
              ["Joined pre-Oct 2002, stayed past Oct 2002","Classic Plus","Classic rules to Sep 2002, Premium rules from Oct 2002. NPA 60."],
              ["30 Jul 2007 – 31 Mar 2015","Nuvos","2.3% of each year's actual pay. NPA 65."],
              ["1 April 2015 onwards","Alpha","2.32% of each year's actual pay. NPA = State Pension Age (min 65)."],
            ]}/>
          </GovDetails>
        </>}

        {/* ══ STEP 1 ══ */}
        {step===1&&<>
          <H1>Your career history</H1>
          <GovHint>Add each employment period, any breaks in service, and any pensions transferred in. Use the buttons at the bottom to add each type.</GovHint>

          {(breakPeriods.length>0||transferPeriods.length>0)&&(
            <div style={{background:G.greenLight,border:`1px solid ${G.greenBorder}`,padding:"10px 14px",marginBottom:20,fontSize:14}}>
              {breakPeriods.length>0&&<span>📅 {breakPeriods.length} break{breakPeriods.length>1?"s":""} in service</span>}
              {breakPeriods.length>0&&transferPeriods.length>0&&<span style={{margin:"0 10px"}}>·</span>}
              {transferPeriods.length>0&&<span>🔄 {transferPeriods.length} transfer{transferPeriods.length>1?"s":""} in</span>}
              {finalSalaryLinkLost&&<div style={{marginTop:6,color:G.error,fontWeight:"bold"}}>
                ⚠ Break of {fmtYrs(longestBreak)} detected — final salary link to pre-break Classic/Premium benefits may be lost.
              </div>}
            </div>
          )}

          {periods.map((p,i)=>{
            if(p.type==="service") return <ServiceCard key={p.id} p={p} i={i} dob={dob} errors={errors}
              updatePeriod={updatePeriod} removePeriod={removePeriod} canRemove={periods.length>1}
              getServiceMonths={getServiceMonths} getServiceYears={getServiceYears}/>;
            if(p.type==="break")   return <BreakCard key={p.id} p={p} i={i} errors={errors}
              updatePeriod={updatePeriod} removePeriod={removePeriod}/>;
            if(p.type==="transfer") return <TransferCard key={p.id} p={p} i={i} errors={errors}
              updatePeriod={updatePeriod} removePeriod={removePeriod}/>;
            return null;
          })}

          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:8}}>
            <button onClick={()=>addPeriod("service")}  style={addBtnSolid}>+ Add employment period</button>
            <button onClick={()=>addPeriod("break")}    style={addBtnOutline}>+ Add break in service</button>
            <button onClick={()=>addPeriod("transfer")} style={addBtnOutline}>+ Add transfer in</button>
          </div>

          <GovDetails summary="What counts as a break in service?">
            <ul style={{lineHeight:1.8,margin:0}}>
              <li><strong>Under 28 days</strong> — usually treated as continuous service.</li>
              <li><strong>28 days to under 5 years</strong> — periods can usually be aggregated. Final salary link retained. On rejoining you accrue in the scheme appropriate to your return date (Alpha from April 2015 onwards).</li>
              <li><strong>5 years or more</strong> — final salary link to Classic/Premium is lost. Pre-break benefits become a deferred pension fixed at leaving salary, uprated by CPI during the break.</li>
            </ul>
          </GovDetails>
          <GovDetails summary="What is a transfer in?">
            <ul style={{lineHeight:1.8,margin:0}}>
              <li><strong>Club transfer</strong> — from another public sector scheme (NHS, teachers, LGPS etc.). Buys a service credit in nuvos, linked to final salary (1/60th × service credit × final salary).</li>
              <li><strong>Non-Club transfer</strong> — from a private pension. Buys a fixed annual pension, uprated by CPI.</li>
            </ul>
          </GovDetails>
        </>}

        {/* ══ STEP 2 ══ */}
        {step===2&&<>
          <H1>Your salary details</H1>

          {finalSalaryLinkLost&&<div style={{background:"#fff4e5",borderLeft:`8px solid ${G.warning}`,padding:"14px 18px",marginBottom:20,fontSize:14,lineHeight:1.7}}>
            <strong>Break of 5 or more years detected</strong>
            <p style={{margin:"6px 0 0"}}>Enter the salary you were on when you left for pre-break service. Post-break service is calculated independently.</p>
          </div>}

          {hasFinalSalary&&<>
            <h2 style={sH2}>Final salary schemes (Classic, Classic Plus, Premium)</h2>
            <GovHint>{finalSalaryLinkLost
              ?"Because your final salary link was lost, enter your salary at the time you left each pre-break period."
              :"Your Classic/Premium/Classic Plus pension is based on your salary when you retire or leave — this applies to all final-salary service no matter when it was built up."}</GovHint>
            <GovField label={finalSalaryLinkLost?"Salary at time of leaving":"Final pensionable salary"} id="fs" required error={errors.fs}
              hint="Basic salary including permanent pensionable allowances. Exclude overtime, ad-hoc bonuses and non-pensionable allowances.">
              <PoundInput id="fs" value={finalSalary} onChange={e=>setFinalSalary(e.target.value)} error={!!errors.fs}/>
            </GovField>
            {carePeriods.length>0&&<Divider/>}
          </>}

          {carePeriods.length>0&&<>
            <h2 style={sH2}>Career average schemes (Nuvos and Alpha)</h2>
            <GovHint>
              For Nuvos and Alpha, your pension is built up year by year as <strong>2.3% (Nuvos) or 2.32% (Alpha) of that year's pensionable pay</strong>. Each April, the whole pot is revalued upwards by CPI (Consumer Prices Index) to protect against inflation. We assume <strong>3% CPI per year</strong> for this estimate. This means your pension at retirement is higher than simply adding the annual percentages together — earlier years benefit from more years of compounding. The "estimated pension" shown in the total row below reflects this CPI compounding, including a pro-rated final part-year if you retire mid-year.
            </GovHint>

            {carePeriods.map(p=>{
              const months = getServiceMonths(p);
              const schemeYears = Math.ceil(months / 12);
              const rate = p.scheme==="nuvos" ? 0.023 : 0.0232;
              const rateLabel = p.scheme==="nuvos" ? "2.3%" : "2.32%";
              const CPI = 0.03;
              // CPI-compounded running total matching the compute function
              const fullYears = Math.floor(months / 12);
              const partMonths = months % 12;
              let pot = 0;
              for(let i=0; i<fullYears; i++){
                const sal = parseFloat(p.salaryInputs?.[i]) || 0;
                pot = (pot + sal * rate) * (1 + CPI);
              }
              if(partMonths > 0){
                const partSal = parseFloat(p.salaryInputs?.[fullYears]) || 0;
                pot += partSal * rate * (partMonths / 12);
              }
              const runningTotal = pot;
              return(
                <div key={p.id} style={{marginBottom:32}}>
                  <h3 style={{fontSize:18,fontWeight:"bold",color:G.greenDark,margin:"0 0 4px"}}>
                    {SCHEME_INFO[p.scheme].label} · {MONTHS[parseInt(p.startMonth)-1]} {p.startYear} – {p.endYear==="present"?"present":`${MONTHS[parseInt(p.endMonth)-1]} ${p.endYear}`}
                  </h3>
                  <p style={{fontSize:14,color:G.textSec,margin:"0 0 14px"}}>{rateLabel} × each year's pay — {fmtYrs(months/12)} of service</p>
                  <div style={{border:`1px solid ${G.border}`,background:G.white}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:15}}>
                      <thead>
                        <tr style={{background:G.greenLight,borderBottom:`2px solid ${G.greenBorder}`}}>
                          <th style={thStyle}>Scheme year</th>
                          <th style={thStyle}>Pensionable pay</th>
                          <th style={{...thStyle,color:G.textSec,fontWeight:"normal",fontSize:13}}>Pension earned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({length:schemeYears},(_,idx)=>{
                          const sal=parseFloat(p.salaryInputs?.[idx])||0;
                          const ek=`si_${p.id}_${idx}`;
                          return(
                            <tr key={idx} style={{borderTop:`1px solid ${G.border}`,background:idx%2===0?G.white:"#fafafa"}}>
                              <td style={{padding:"10px 14px",fontWeight:"bold",width:120}}>{yearLabel(p,idx)}</td>
                              <td style={{padding:"8px 14px"}}>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <span style={{fontSize:16}}>£</span>
                                  <input type="number" value={p.salaryInputs?.[idx]??""} onChange={e=>updateSalaryInput(p.id,idx,e.target.value)}
                                    placeholder="e.g. 35000"
                                    style={{border:`2px solid ${errors[ek]?G.error:G.border}`,padding:"7px 10px",fontSize:15,width:160,fontFamily:G.font,outline:"none",color:"#0b0c0c",background:"#ffffff"}}/>
                                </div>
                                {errors[ek]&&<div style={{color:G.error,fontSize:13,marginTop:4}}>Enter a salary for this year</div>}
                              </td>
                              <td style={{padding:"10px 14px",color:sal>0?G.greenDark:G.textSec,fontWeight:sal>0?"bold":"normal"}}>
                                {sal>0?fmt(sal*rate)+" raw":"—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{background:G.greenLight,borderTop:`2px solid ${G.greenBorder}`}}>
                          <td style={{padding:"10px 14px",fontWeight:"bold"}}>Estimated pension</td>
                          <td style={{padding:"10px 14px",color:G.textSec,fontSize:13}}>
                            {(p.salaryInputs||[]).filter(Boolean).length} of {schemeYears} entered
                            {partMonths>0&&<span style={{display:"block",fontSize:11,marginTop:2}}>incl. {partMonths}-month part year</span>}
                          </td>
                          <td style={{padding:"10px 14px",fontWeight:"bold",color:G.greenDark}}>
                            {fmt(runningTotal)}/yr
                            <div style={{fontSize:11,fontWeight:"normal",color:G.textSec,marginTop:2}}>incl. 3% CPI compounding</div>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <GovDetails summary="I don't have exact figures for every year">
                    <p style={{marginTop:0}}>Check your <strong>Annual Benefit Statements</strong> (available on the Pension Portal) or your P60/payslips. If estimating, small differences have limited impact on the overall total.</p>
                  </GovDetails>
                </div>
              );
            })}
          </>}

          {hasClubTransfer&&<>
            <Divider/>
            <h2 style={sH2}>Club transfer — salary link</h2>
            <GovInset>Club transfer service credits are calculated as <strong>service credit × 1/60 × your final salary</strong>. This uses the final salary entered above — no additional input needed.</GovInset>
          </>}
        </>}

        {/* ══ STEP 3 ══ */}
        {step===3&&<>
          <H1>Retirement plans</H1>

          <h2 style={sH2}>Intended retirement date</h2>
          <GovHint>{dob?`Alpha NPA: ${getAlphaNPA(dob)} · Classic/Premium NPA: 60 · Nuvos NPA: 65 · Minimum pension age: ${getMinAge(dob)}`:""}</GovHint>
          <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end",marginBottom:24}}>
            <GovField label="Month" id="retMonth" compact>
              <GovSelect value={retMonth} onChange={e=>setRetMonth(e.target.value)} width={160}>
                {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
              </GovSelect>
            </GovField>
            <GovField label="Year" id="retYear" error={errors.ra} required compact>
              <GovInput id="retYear" type="number" min="2024" max="2075" value={retYear}
                onChange={e=>setRetYear(e.target.value)} width={110} placeholder="e.g. 2032" error={!!errors.ra}/>
            </GovField>
          </div>
          {errors.ra&&<ErrorMsg>{errors.ra}</ErrorMsg>}

          <Divider/>
          <h2 style={sH2}>Retirement basis</h2>

          {[
            {val:"normal",label:"Normal or late retirement",
              hint:"At or after your Normal Pension Age. Full pension with no reduction."},
            {val:"early",label:"Voluntary early retirement (own decision)",
              hint:"Before your NPA, leaving employment of your own accord with no employer scheme. Actuarial reduction applied per scheme: ~4%/yr early (Alpha); ~5% first 3 years then 4% thereafter (Classic, Premium, Nuvos). Reduction is permanent for life."},
            {val:"voluntary_retirement",label:"Voluntary Retirement under CSCS (employer exit scheme)",
              hint:"Leaving under a Civil Service Compensation Scheme voluntary exit or voluntary redundancy arrangement. You receive a compensation payment and may use it to buy out some or all of the actuarial reduction. Must have reached minimum pension age (50 or 55). Actuarial reduction shown — buy-out option explained in results."},
            {val:"ill_health_lower",label:"Ill-health retirement — Lower Tier",
              hint:"Scheme Medical Adviser confirms you cannot carry out your current role again before NPA. Full accrued pension with no early payment reduction."},
            {val:"ill_health_upper",label:"Ill-health retirement — Upper Tier",
              hint:"Scheme Medical Adviser confirms you cannot carry out any gainful employment before NPA. Full pension plus enhancement: average annual accrual × remaining years to NPA."},
          ].map(opt=>(
            <GovRadio key={opt.val} name="basis" value={opt.val}
              checked={basis===opt.val} onChange={()=>setBasis(opt.val)}
              label={opt.label} hint={opt.hint}/>
          ))}

          {basis==="voluntary_retirement"&&<>
            <Divider/>
            <h2 style={sH2}>CSCS compensation payment (optional)</h2>
            <GovHint>Under the CSCS 2010, voluntary exit/redundancy pays 1 month's salary per year of service up to 21 months. You can use this to buy out your actuarial reduction. Enter your estimated compensation below if known — the results page will show whether it is likely to cover the buy-out cost.</GovHint>
            <GovField label="Estimated compensation payment (months of salary)" id="vrm" hint="Leave blank to use the calculated maximum based on your service">
              <GovInput id="vrm" type="number" min="0" max="21" value={vrSeveranceMonths}
                onChange={e=>setVrSeveranceMonths(e.target.value)} width={110} placeholder="e.g. 12"/>
            </GovField>
          </>}

          <Divider/>
          <h2 style={sH2}>Pension commutation (optional)</h2>
          <GovHint>Exchange annual pension for a larger tax-free lump sum at retirement. The rate is <strong>£12 lump sum for every £1 of annual pension given up</strong>. This applies to all schemes including Classic.</GovHint>
          <GovCheckbox id="commute" checked={commute} onChange={e=>setCommute(e.target.checked)} label="I want to commute additional pension into a lump sum"/>
          {commute&&<div style={{paddingLeft:36,marginTop:8}}>
            <GovField label="Annual pension to give up (£ per year)" id="commuteAmt" hint="Every £1 given up = £12 lump sum.">
              <PoundInput id="commuteAmt" value={commuteAmt} onChange={e=>setCommuteAmt(e.target.value)}/>
            </GovField>
            {commuteAmt&&!isNaN(commuteAmt)&&parseFloat(commuteAmt)>0&&<GovInset>
              Additional lump sum: <strong>{fmt(parseFloat(commuteAmt)*12)}</strong><br/>
              Annual pension reduced by: <strong>{fmt(parseFloat(commuteAmt))}/year</strong>
            </GovInset>}
          </div>}
        </>}

        {/* ══ STEP 4: RESULTS ══ */}
        {step===4&&results&&<>
          <H1>{name?`${name}'s pension estimate`:"Your pension estimate"}</H1>

          {/* Headline pension — for VR show the buy-out (best case) figure as the primary */}
          {results.basis==="voluntary_retirement"
            ?<>
              <div style={{background:G.green,color:G.white,padding:"22px 24px",marginBottom:4}}>
                <div style={{fontSize:13,marginBottom:4,opacity:0.85}}>
                  Estimated annual pension — Voluntary Redundancy with buy-out applied (before tax)
                </div>
                <div style={{fontSize:46,fontWeight:"bold",lineHeight:1,marginBottom:6}}>
                  {fmt(results.vrPensionIfFullBuyOut - results.commuteGiveUp)}
                </div>
                <div style={{fontSize:18,opacity:0.9}}>
                  {fmt((results.vrPensionIfFullBuyOut - results.commuteGiveUp) / 12)} per month
                </div>
                <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.35)",fontSize:13,display:"flex",flexWrap:"wrap",gap:"16px 24px"}}>
                  <div>
                    <div style={{opacity:0.75,marginBottom:2}}>Post-break service (unreduced)</div>
                    <div style={{fontWeight:"bold"}}>{fmt(results.vrPostBreakUnreduced)}/yr</div>
                  </div>
                  {results.hasPreBreakService&&<div>
                    <div style={{opacity:0.75,marginBottom:2}}>Pre-break deferred (actuarially reduced)</div>
                    <div style={{fontWeight:"bold"}}>{fmt(results.vrPreBreakReduced)}/yr</div>
                  </div>}
                  {results.vrTransfersReduced>0&&<div>
                    <div style={{opacity:0.75,marginBottom:2}}>Transfers in (actuarially reduced)</div>
                    <div style={{fontWeight:"bold"}}>{fmt(results.vrTransfersReduced)}/yr</div>
                  </div>}
                  {results.commuteGiveUp>0&&<div>
                    <div style={{opacity:0.75,marginBottom:2}}>Less commutation</div>
                    <div style={{fontWeight:"bold"}}>−{fmt(results.commuteGiveUp)}/yr</div>
                  </div>}
                </div>
              </div>
              <div style={{background:"#505a5f",color:G.white,padding:"12px 20px",marginBottom:20,fontSize:14}}>
                If <strong>no buy-out</strong> is made (or under Voluntary Exit terms where shortfall is not covered):&nbsp;
                <strong>{fmt(results.finalPension)}/yr</strong> ({fmt(results.monthly)}/month)
                &nbsp;— see CSCS section below for full detail.
              </div>
            </>
            :<div style={{background:G.green,color:G.white,padding:"22px 24px",marginBottom:20}}>
              <div style={{fontSize:14,marginBottom:6,opacity:0.9}}>Estimated annual pension (before tax)</div>
              <div style={{fontSize:46,fontWeight:"bold",lineHeight:1,marginBottom:6}}>{fmt(results.finalPension)}</div>
              <div style={{fontSize:18,opacity:0.9}}>{fmt(results.monthly)} per month</div>
            </div>
          }

          {results.lumpFromCommute>0&&<div style={{background:G.greenLight,border:`2px solid ${G.greenBorder}`,padding:"16px 20px",marginBottom:20}}>
            <div style={{fontSize:14,color:G.textSec,marginBottom:4}}>Tax-free lump sum (from commutation)</div>
            <div style={{fontSize:32,fontWeight:"bold",color:G.greenDark}}>{fmt(results.lumpFromCommute)}</div>
            <div style={{fontSize:13,color:G.textSec,marginTop:4}}>
              {fmt(results.commuteGiveUp)}/yr of pension given up × 12 = {fmt(results.lumpFromCommute)} tax-free cash
            </div>
          </div>}

          {/* Early reduction summary */}
          {(results.basis==="early"||results.basis==="voluntary_retirement")&&results.totalUnreduced!==results.totalReduced&&(
            <div style={{background:"#fff7e6",borderLeft:`8px solid ${G.warning}`,padding:"14px 18px",marginBottom:20}}>
              <strong>Actuarial reductions applied per scheme</strong>
              <p style={{margin:"6px 0 0",fontSize:14,lineHeight:1.6}}>
                Unreduced pension would have been <strong>{fmt(results.totalUnreduced)}</strong>.
                Total reduction: <strong>{fmt(results.totalUnreduced-results.totalReduced)}</strong>/yr ({fmtPct((results.totalUnreduced-results.totalReduced)/results.totalUnreduced)}).
                Reductions are applied separately to each scheme element — see breakdown below.
                {results.basis==="voluntary_retirement"&&" See the CSCS buy-out section below for options to reduce or eliminate these reductions."}
              </p>
            </div>
          )}

          {/* CSCS voluntary retirement box */}
          {results.basis==="voluntary_retirement"&&<div style={{background:"#e8f0fe",border:`2px solid ${G.link}`,padding:"18px 20px",marginBottom:24}}>
            <strong style={{fontSize:16,color:G.link}}>🔄 Civil Service Compensation Scheme — Voluntary Exit / Redundancy</strong>

            {/* Rule explanation */}
            <div style={{background:"#f0f4ff",border:`1px solid ${G.link}`,padding:"10px 14px",margin:"12px 0",fontSize:13,lineHeight:1.7}}>
              <strong>How the CSCS buy-out works:</strong> Under CSCS 2010, your compensation payment and any employer buy-out subsidy (under VR terms) apply <strong>only to your post-last-break continuous service</strong>. Any pension built up before a break in service is a separate deferred pension — it can be taken early but the actuarial reduction on it cannot be bought out using compensation.
            </div>

            {/* Post-break service section */}
            <h3 style={{fontSize:15,fontWeight:"bold",margin:"14px 0 8px",color:G.greenDark}}>
              Current continuous service (post-{results.hasPreBreakService?"last break":"joining"})
            </h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
              <div style={{background:G.white,border:`1px solid ${G.border}`,padding:"10px 12px"}}>
                <div style={{fontSize:11,color:G.textSec,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Service</div>
                <div style={{fontSize:18,fontWeight:"bold"}}>{fmtYrs(results.vrPostBreakYrs)}</div>
              </div>
              <div style={{background:G.white,border:`1px solid ${G.border}`,padding:"10px 12px"}}>
                <div style={{fontSize:11,color:G.textSec,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Pension (unreduced)</div>
                <div style={{fontSize:18,fontWeight:"bold",color:G.greenDark}}>{fmt(results.vrPostBreakUnreduced)}/yr</div>
              </div>
              <div style={{background:G.white,border:`1px solid ${G.border}`,padding:"10px 12px"}}>
                <div style={{fontSize:11,color:G.textSec,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Actuarial reduction</div>
                <div style={{fontSize:18,fontWeight:"bold",color:results.vrPostBreakReduction>0?G.error:G.green}}>
                  {results.vrPostBreakReduction>0?`−${fmt(results.vrPostBreakReduction)}/yr`:"None"}
                </div>
              </div>
            </div>

            <p style={{margin:"0 0 6px",fontSize:14}}><strong>Estimated CSCS compensation payment</strong> (1 month × {Math.min(21,Math.floor(results.vrPostBreakYrs))} months, max 21):</p>
            <div style={{fontSize:26,fontWeight:"bold",color:G.greenDark,marginBottom:12}}>{fmt(results.vrCompensation)}</div>

            {results.vrPostBreakReduction > 0 ? <>
              <p style={{margin:"0 0 6px",fontSize:14}}><strong>Estimated cost to buy out the actuarial reduction on post-break service</strong> (indicative factor of 20×):</p>
              <div style={{fontSize:26,fontWeight:"bold",color:results.vrBuyOutCostPostBreak<=results.vrCompensation?G.green:G.error,marginBottom:12}}>
                {fmt(results.vrBuyOutCostPostBreak)}
              </div>

              {results.vrBuyOutCostPostBreak <= results.vrCompensation
                ? <div style={{background:"#e8f5e9",border:`1px solid ${G.green}`,padding:"12px 14px",fontSize:14,color:G.greenDark,marginBottom:12}}>
                    <strong>✓ Your compensation payment appears sufficient to fully buy out the actuarial reduction on your current service.</strong>
                    <br/>Post-break pension would be paid unreduced at <strong>{fmt(results.vrPostBreakUnreduced)}/yr</strong>.
                    {results.hasPreBreakService&&<><br/>Your pre-break deferred pension of <strong>{fmt(results.vrPreBreakReduced)}/yr</strong> would still be actuarially reduced (no buy-out available on that element).</>}
                    <br/><strong>Combined pension if buy-out exercised: {fmt(results.vrPensionIfFullBuyOut)}/yr</strong>
                  </div>
                : <div style={{background:"#fff4e5",border:`1px solid ${G.warning}`,padding:"12px 14px",fontSize:14,marginBottom:12}}>
                    <strong>⚠ The estimated buy-out cost exceeds your compensation payment by {fmt(results.vrBuyOutCostPostBreak - results.vrCompensation)}.</strong>
                    <br/>Under <strong>Voluntary Redundancy</strong> terms: your employer must top up to cover the full buy-out cost. You receive your post-break pension unreduced.
                    <br/>Under <strong>Voluntary Exit</strong> terms: you must fund the shortfall yourself, or accept the actuarially reduced pension.
                    {results.hasPreBreakService&&<><br/>Either way, your pre-break deferred pension of <strong>{fmt(results.vrPreBreakReduced)}/yr</strong> remains actuarially reduced — no buy-out applies.</>}
                    <br/><strong>Combined pension if VR buy-out fully applied: {fmt(results.vrPensionIfFullBuyOut)}/yr</strong>
                  </div>
              }
            </> : <div style={{background:"#e8f5e9",border:`1px solid ${G.green}`,padding:"12px 14px",fontSize:14,color:G.greenDark,marginBottom:12}}>
              ✓ No actuarial reduction applies to your post-break service — you are retiring at or after its NPA.
            </div>}

            {/* Pre-break section */}
            {results.hasPreBreakService&&<>
              <h3 style={{fontSize:15,fontWeight:"bold",margin:"16px 0 8px",color:G.greenDark}}>Pre-break deferred pension</h3>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:8}}>
                <div style={{background:G.white,border:`1px solid ${G.border}`,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:G.textSec,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Service</div>
                  <div style={{fontSize:18,fontWeight:"bold"}}>{fmtYrs(results.vrPreBreakYrs)}</div>
                </div>
                <div style={{background:G.white,border:`1px solid ${G.border}`,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:G.textSec,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Pension (unreduced)</div>
                  <div style={{fontSize:18,fontWeight:"bold",color:G.greenDark}}>{fmt(results.vrPreBreakUnreduced)}/yr</div>
                </div>
                <div style={{background:G.white,border:`1px solid ${G.border}`,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:G.textSec,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>After AR (no buy-out)</div>
                  <div style={{fontSize:18,fontWeight:"bold",color:results.vrPreBreakReduction>0?G.error:G.green}}>{fmt(results.vrPreBreakReduced)}/yr</div>
                </div>
              </div>
              <div style={{background:"#fff4e5",border:`1px solid ${G.warning}`,padding:"10px 14px",fontSize:13}}>
                ⚠ <strong>No buy-out available on pre-break service.</strong> This deferred pension is taken early on an actuarially reduced basis only. The reduction shown is permanent for life.
              </div>
            </>}

            <p style={{margin:"16px 0 0",fontSize:12,color:G.textSec,fontStyle:"italic",borderTop:`1px solid ${G.border}`,paddingTop:10}}>
              Buy-out costs are estimated using an indicative capitalisation factor of 20. Exact costs are set by the Government Actuary's Department and provided by the Scheme Administrator. Compensation calculations use current CSCS 2010 terms (1 month/year, max 21 months). The headline pension figure above shows the <em>actuarially reduced</em> position — i.e. if no buy-out is exercised.
            </p>
          </div>}

          {/* Breakdown table */}
          <h2 style={{...sH2,marginTop:28}}>How your pension is built up</h2>
          <div style={{background:G.greenLight,border:`1px solid ${G.greenBorder}`,padding:"8px 14px",marginBottom:12,fontSize:13,color:G.greenDark}}>
            ℹ️ <strong>Alpha and Nuvos figures include CPI revaluation at an assumed 3% per year.</strong> Each April the whole pot is uprated by 3% — earlier years of service benefit from more years of compounding. The final part-year (if retiring mid-year) is added at raw accrual value with no CPI applied, as CPI is only awarded on April scheme anniversaries.
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,marginBottom:24}}>
            <thead>
              <tr style={{background:G.greenDark,color:G.white}}>
                {["Component","Service","Unreduced pension","Reduction","Reduced pension","NPA"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:12}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.breakdown.map((b,i)=>(
                <tr key={i} style={{background:i%2===0?G.white:G.bg,borderBottom:`1px solid ${G.border}`}}>
                  <td style={{padding:"9px 10px",fontWeight:"bold",fontSize:13}}>
                    {b.isTransfer&&<span style={{fontSize:10,background:G.link,color:"white",padding:"1px 5px",marginRight:5}}>TRANSFER</span>}
                    {b.label}
                  </td>
                  <td style={{padding:"9px 10px",whiteSpace:"nowrap"}}>{b.years!=null?fmtYrs(b.years):""}</td>
                  <td style={{padding:"9px 10px"}}>{fmt(b.unreduced+b.enhancement)}</td>
                  <td style={{padding:"9px 10px",color:b.factor<1?G.error:G.textSec}}>
                    {b.factor<1?`−${fmtPct(1-b.factor)} (${fmtYrs(b.yearsEarly)} early)`:"None"}
                  </td>
                  <td style={{padding:"9px 10px",fontWeight:"bold"}}>{fmt(b.reduced)}</td>
                  <td style={{padding:"9px 10px"}}>{b.npa}</td>
                </tr>
              ))}
              <tr style={{background:G.greenLight,borderTop:`2px solid ${G.greenBorder}`,fontWeight:"bold"}}>
                <td style={{padding:"9px 10px"}}>Total</td>
                <td></td>
                <td style={{padding:"9px 10px"}}>{fmt(results.totalUnreduced)}</td>
                <td style={{padding:"9px 10px",color:results.totalUnreduced!==results.totalReduced?G.error:G.textSec}}>
                  {results.totalUnreduced!==results.totalReduced?`−${fmt(results.totalUnreduced-results.totalReduced)}`:"-"}
                </td>
                <td style={{padding:"9px 10px"}}>{fmt(results.totalReduced)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          {/* Key figures */}
          <h2 style={sH2}>Key figures</h2>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:15,marginBottom:28}}>
            <tbody>
              {[
                ["Planned retirement date",`${MONTHS[results.retDate.month-1]} ${results.retDate.year}`],
                ["Estimated retirement age",`${results.retAgeDecimal} years`],
                ["State Pension Age",results.spa],
                ["Alpha Normal Pension Age",results.aNPA],
                ["Retirement basis",{normal:"Normal/late retirement",early:"Voluntary early retirement",voluntary_retirement:"CSCS Voluntary Exit/Redundancy",ill_health_lower:"Ill-health — Lower Tier",ill_health_upper:"Ill-health — Upper Tier"}[results.basis]],
                results.basis==="voluntary_retirement"?["Pension (with VR buy-out applied)",`${fmt(results.vrPensionIfFullBuyOut - results.commuteGiveUp)}/yr · ${fmt((results.vrPensionIfFullBuyOut - results.commuteGiveUp)/12)}/month`]:null,
                results.basis==="voluntary_retirement"?["Pension (no buy-out / VE reduced)",`${fmt(results.finalPension)}/yr · ${fmt(results.monthly)}/month`]:null,
                results.hasBreaks?["Longest break in service",`${fmtYrs(results.longestBreak)} ${results.finalSalaryLinkLost?"— final salary link LOST":"— final salary link retained"}`]:null,
                results.commuteGiveUp>0?["Pension commuted",`${fmt(results.commuteGiveUp)}/yr → ${fmt(results.lumpFromCommute)} lump sum`]:null,
              ].filter(Boolean).map(([k,v],i)=>(
                <tr key={k} style={{background:i%2===0?G.white:G.bg,borderBottom:`1px solid ${G.border}`}}>
                  <th style={{padding:"10px 14px",textAlign:"left",fontWeight:"bold",width:"55%",borderRight:`1px solid ${G.border}`}}>{k}</th>
                  <td style={{padding:"10px 14px"}}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Strong disclaimer */}
          <div style={{background:"#fff4e5",border:`3px solid ${G.warning}`,padding:"20px 24px",fontSize:14,lineHeight:1.8,marginBottom:24}}>
            <strong style={{fontSize:16,color:G.error}}>⚠ IMPORTANT — THIS IS AN ESTIMATE ONLY. NOT FINANCIAL, PENSION OR LEGAL ADVICE.</strong>
            <p style={{margin:"10px 0 8px"}}>This is an <strong>independent informal tool</strong> not affiliated with HM Government, Cabinet Office, Civil Service Pensions or Capita. It is not a formal benefit statement.</p>
            <p style={{margin:"0 0 8px"}}><strong>Do not make any retirement, financial or employment decision based on these figures alone.</strong> Your actual pension will be calculated by the Scheme Administrator from verified records.</p>
            <p style={{margin:"0 0 8px"}}>Not covered: McCloud/2015 Remedy · Added Pension/AVCs · Exact CPI uprating · Pension sharing orders · Abatement · EPA/EEPA · Exact GAD actuarial factors · Future SPA changes.</p>
            <p style={{margin:"0 0 8px"}}>CSCS buy-out costs shown are indicative only. Exact costs require GAD factors available from the Scheme Administrator.</p>
            <p style={{margin:0,fontSize:13,color:G.textSec,borderTop:`1px solid ${G.border}`,paddingTop:10,marginTop:10}}>For an official estimate: <strong>www.civilservicepensionscheme.org.uk</strong> · For regulated financial advice: <strong>www.moneyhelper.org.uk</strong> or <strong>www.unbiased.co.uk</strong> · The operator accepts no liability for any loss arising from reliance on these estimates.</p>
          </div>

          <div style={{display:"flex",gap:16,marginTop:24,alignItems:"center"}}>
            <button onClick={()=>{setStep(0);setResults(null);setFinalSalary("");setRetYear("");setPeriods([makePeriod("service")]);window.scrollTo({top:0,behavior:"smooth"});}} style={addBtnSolid}>
              Start a new calculation
            </button>
            <button onClick={()=>{setResults(null);setStep(3);window.scrollTo({top:0,behavior:"smooth"});}} style={backLink}>
              ← Back to change retirement terms
            </button>
          </div>
        </>}

        {/* NAV */}
        {step<4&&<div style={{display:"flex",gap:16,marginTop:36,alignItems:"center"}}>
          <button onClick={next} style={primaryBtn}>{step===3?"Calculate my pension":"Continue"}</button>
          {step>0&&<button onClick={back} style={backLink}>Back</button>}
        </div>}
      </div>
      <Footer/>
    </div>
  );
}

// ─── PERIOD CARDS ─────────────────────────────────────────────────────────────

function ServiceCard({p,i,dob,errors,updatePeriod,removePeriod,canRemove,getServiceMonths,getServiceYears}){
  const months = getServiceMonths(p);
  const yrs    = months / 12;
  const npa    = getNPA(p.scheme, dob);
  return(
    <div style={{border:`2px solid ${G.greenBorder}`,marginBottom:20,background:G.white}}>
      <div style={{background:G.greenLight,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${G.greenBorder}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:11,background:G.green,color:"white",padding:"2px 8px",fontWeight:"bold"}}>EMPLOYMENT</span>
          <strong style={{fontSize:16}}>{SCHEME_INFO[p.scheme]?.label||p.scheme}</strong>
        </div>
        {canRemove&&<button onClick={()=>removePeriod(p.id)} style={removeBtn}>Remove</button>}
      </div>
      <div style={{padding:20}}>
        <GovField label="Pension scheme" id={`scheme_${i}`}>
          <GovSelect value={p.scheme} onChange={e=>updatePeriod(p.id,"scheme",e.target.value)}>
            <option value="alpha">Alpha (April 2015 onwards)</option>
            <option value="nuvos">Nuvos (July 2007 – March 2015)</option>
            <option value="premium">Premium (October 2002 – July 2007)</option>
            <option value="classicplus">Classic Plus (joined before Oct 2002, continued past Oct 2002)</option>
            <option value="classic">Classic (joined and left before October 2002)</option>
          </GovSelect>
        </GovField>

        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <GovField label="Start date" id={`sd_${i}`} error={errors[`sy_${i}`]} required compact>
            <div style={{display:"flex",gap:8}}>
              <GovSelect value={p.startMonth} onChange={e=>updatePeriod(p.id,"startMonth",e.target.value)} width={140}>
                {MONTHS.map((m,mi)=><option key={mi} value={mi+1}>{m}</option>)}
              </GovSelect>
              <GovInput id={`sy_${i}`} type="number" min="1972" max={CY} value={p.startYear}
                onChange={e=>updatePeriod(p.id,"startYear",e.target.value)} width={100} placeholder="Year" error={!!errors[`sy_${i}`]}/>
            </div>
          </GovField>
          <GovField label="End date" id={`ed_${i}`} compact>
            <div style={{display:"flex",gap:8}}>
              <GovSelect value={p.endMonth} onChange={e=>updatePeriod(p.id,"endMonth",e.target.value)} width={140}>
                {MONTHS.map((m,mi)=><option key={mi} value={mi+1}>{m}</option>)}
              </GovSelect>
              <GovSelect value={p.endYear} onChange={e=>updatePeriod(p.id,"endYear",e.target.value)} width={120}>
                <option value="present">Present</option>
                {Array.from({length:CY-1972+1},(_,k)=>CY-k).map(y=><option key={y} value={y}>{y}</option>)}
              </GovSelect>
            </div>
          </GovField>
        </div>

        {errors[`yr_${i}`]&&<ErrorMsg>{errors[`yr_${i}`]}</ErrorMsg>}

        {p.scheme==="classicplus"&&<GovField label="Years of Classic service (before 1 October 2002)" id={`cy_${i}`}
          hint="Number of years accrued under Classic rules before October 2002" error={errors[`cy_${i}`]} required>
          <GovInput id={`cy_${i}`} type="number" min="0" max={yrs} value={p.classicYears}
            onChange={e=>updatePeriod(p.id,"classicYears",e.target.value)} width={80} error={!!errors[`cy_${i}`]}/>
        </GovField>}

        {months>0&&<div style={{background:G.greenLight,border:`1px solid ${G.greenBorder}`,padding:"8px 12px",fontSize:14,marginTop:4,color:G.greenDark}}>
          <strong>{fmtYrs(yrs)}</strong> of service · NPA: <strong>{npa}</strong>
          {["nuvos","alpha"].includes(p.scheme)&&<span style={{color:G.textSec}}> · Year-by-year salaries needed on next step</span>}
        </div>}
      </div>
    </div>
  );
}

function BreakCard({p,i,errors,updatePeriod,removePeriod}){
  let breakYrs = 0;
  if(p.breakStartYear && p.breakEndYear){
    breakYrs = yearsBetween(
      {month:parseInt(p.breakStartMonth),year:parseInt(p.breakStartYear)},
      {month:parseInt(p.breakEndMonth),  year:parseInt(p.breakEndYear)}
    );
  }
  const lost = breakYrs >= 5;
  return(
    <div style={{border:`2px solid ${G.warning}`,marginBottom:20,background:G.white}}>
      <div style={{background:"#fff0e0",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${G.warning}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:11,background:G.warning,color:"white",padding:"2px 8px",fontWeight:"bold"}}>BREAK</span>
          <strong style={{fontSize:16}}>Break in service</strong>
        </div>
        <button onClick={()=>removePeriod(p.id)} style={removeBtn}>Remove</button>
      </div>
      <div style={{padding:20}}>
        <GovHint>A break of 5 or more years means the final salary link for Classic/Premium built up before the break is lost. On rejoining after any break, you accrue in the scheme appropriate to your return date (Alpha from April 2015).</GovHint>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <GovField label="Break start" id={`bs_${i}`} error={errors[`bs_${i}`]} required compact>
            <div style={{display:"flex",gap:8}}>
              <GovSelect value={p.breakStartMonth} onChange={e=>updatePeriod(p.id,"breakStartMonth",e.target.value)} width={140}>
                {MONTHS.map((m,mi)=><option key={mi} value={mi+1}>{m}</option>)}
              </GovSelect>
              <GovInput id={`bs_${i}`} type="number" min="1972" max={CY} value={p.breakStartYear}
                onChange={e=>updatePeriod(p.id,"breakStartYear",e.target.value)} width={100} placeholder="Year" error={!!errors[`bs_${i}`]}/>
            </div>
          </GovField>
          <GovField label="Rejoined CS" id={`be_${i}`} error={errors[`be_${i}`]} required compact>
            <div style={{display:"flex",gap:8}}>
              <GovSelect value={p.breakEndMonth} onChange={e=>updatePeriod(p.id,"breakEndMonth",e.target.value)} width={140}>
                {MONTHS.map((m,mi)=><option key={mi} value={mi+1}>{m}</option>)}
              </GovSelect>
              <GovInput id={`be_${i}`} type="number" min="1972" max={CY} value={p.breakEndYear}
                onChange={e=>updatePeriod(p.id,"breakEndYear",e.target.value)} width={100} placeholder="Year" error={!!errors[`be_${i}`]}/>
            </div>
          </GovField>
        </div>
        {breakYrs>0&&<div style={{background:lost?"#fde8e0":"#e8f5e9",border:`1px solid ${lost?G.error:G.green}`,padding:"8px 12px",fontSize:14,marginTop:4,color:lost?G.error:G.greenDark,fontWeight:"bold"}}>
          {fmtYrs(breakYrs)} break {lost?"— final salary link LOST (5+ years)":"— final salary link retained (under 5 years)"}
        </div>}
      </div>
    </div>
  );
}

function TransferCard({p,i,errors,updatePeriod,removePeriod}){
  return(
    <div style={{border:`2px solid ${G.link}`,marginBottom:20,background:G.white}}>
      <div style={{background:"#dce9f7",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${G.link}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:11,background:G.link,color:"white",padding:"2px 8px",fontWeight:"bold"}}>TRANSFER IN</span>
          <strong style={{fontSize:16}}>Pension transferred in</strong>
        </div>
        <button onClick={()=>removePeriod(p.id)} style={removeBtn}>Remove</button>
      </div>
      <div style={{padding:20}}>
        <GovField label="Type of transfer" id={`tt_${i}`} hint="Check your transfer paperwork or Annual Benefit Statement.">
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
            {[{val:"club",label:"Club transfer",desc:"From another public sector scheme. Bought a service credit in nuvos linked to final salary."},
              {val:"nonclub",label:"Non-Club transfer",desc:"From a private pension. Bought a fixed annual pension, uprated by CPI."}
            ].map(opt=>(
              <label key={opt.val} style={{display:"flex",gap:12,cursor:"pointer",alignItems:"flex-start",background:p.transferType===opt.val?G.greenLight:"transparent",border:`2px solid ${p.transferType===opt.val?G.greenBorder:G.border}`,padding:"10px 12px"}}>
                <input type="radio" name={`tt_${p.id}`} value={opt.val} checked={p.transferType===opt.val}
                  onChange={()=>updatePeriod(p.id,"transferType",opt.val)}
                  style={{marginTop:3,accentColor:G.green,width:18,height:18,flexShrink:0}}/>
                <div><div style={{fontSize:15,fontWeight:"bold"}}>{opt.label}</div>
                  <div style={{fontSize:13,color:G.textSec,marginTop:2}}>{opt.desc}</div></div>
              </label>
            ))}
          </div>
        </GovField>
        <GovField label="Transferred into which scheme" id={`ts_${i}`} hint="Usually Nuvos for Club transfers.">
          <GovSelect value={p.transferScheme} onChange={e=>updatePeriod(p.id,"transferScheme",e.target.value)} width={260}>
            <option value="nuvos">Nuvos</option><option value="alpha">Alpha</option>
            <option value="premium">Premium</option><option value="classic">Classic</option>
          </GovSelect>
        </GovField>
        {p.transferType==="club"
          ?<GovField label="Service credit received (years)" id={`tc_${i}`} error={errors[`tc_${i}`]} required hint="Shown on your transfer confirmation or Annual Benefit Statement.">
            <GovInput id={`tc_${i}`} type="number" min="0" max="50" value={p.serviceCredit}
              onChange={e=>updatePeriod(p.id,"serviceCredit",e.target.value)} width={120} placeholder="e.g. 8.5" error={!!errors[`tc_${i}`]}/>
          </GovField>
          :<GovField label="Annual pension bought (£/year)" id={`tv_${i}`} error={errors[`tv_${i}`]} required hint="Shown on your transfer confirmation. Uprated by CPI each year.">
            <PoundInput id={`tv_${i}`} value={p.annualPensionValue} onChange={e=>updatePeriod(p.id,"annualPensionValue",e.target.value)} error={!!errors[`tv_${i}`]}/>
          </GovField>}
      </div>
    </div>
  );
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function H1({children}){return<h1 style={{fontSize:32,fontWeight:"bold",margin:"0 0 8px",borderBottom:`4px solid ${G.green}`,paddingBottom:12}}>{children}</h1>;}
function GovHint({children}){return<p style={{color:G.textSec,fontSize:16,margin:"4px 0 20px",lineHeight:1.6}}>{children}</p>;}
function GovField({label,id,hint,error,required,compact,children}){
  return<div style={{marginBottom:compact?0:22}}>
    <label htmlFor={id} style={{display:"block",fontWeight:"bold",fontSize:17,marginBottom:4}}>
      {label}{required&&<span style={{color:G.error}}> *</span>}
    </label>
    {hint&&<div style={{color:G.textSec,fontSize:14,marginBottom:6}}>{hint}</div>}
    {error&&<ErrorMsg>{error}</ErrorMsg>}
    {children}
  </div>;
}
function GovInput({id,type="text",value,onChange,width,placeholder,error}){
  return<input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder}
    style={{border:`2px solid ${error?G.error:G.borderDark}`,padding:"8px 12px",fontSize:17,
      width:width||"100%",fontFamily:G.font,outline:"none",boxSizing:"border-box",color:G.text,background:G.white}}/>;
}
function GovSelect({value,onChange,children,width}){
  return<select value={value} onChange={onChange}
    style={{border:`2px solid ${G.borderDark}`,padding:"8px 12px",fontSize:16,fontFamily:G.font,
      background:G.white,color:G.text,width:width||"100%",outline:"none",cursor:"pointer"}}>
    {children}
  </select>;
}
function PoundInput({id,value,onChange,error}){
  return<div style={{display:"flex",alignItems:"center",gap:8}}>
    <span style={{fontSize:20,fontWeight:"bold"}}>£</span>
    <GovInput id={id} type="number" value={value} onChange={onChange} width={200} placeholder="e.g. 42000" error={error}/>
  </div>;
}
function GovRadio({name,value,checked,onChange,label,hint}){
  return<label style={{display:"flex",gap:12,marginBottom:10,cursor:"pointer",alignItems:"flex-start",
    background:checked?G.greenLight:G.white,border:`2px solid ${checked?G.greenBorder:G.border}`,padding:"12px 14px"}}>
    <input type="radio" name={name} value={value} checked={checked} onChange={onChange}
      style={{marginTop:3,accentColor:G.green,width:20,height:20,flexShrink:0}}/>
    <div><div style={{fontSize:16,fontWeight:"bold"}}>{label}</div>
      {hint&&<div style={{fontSize:14,color:G.textSec,marginTop:3,lineHeight:1.5}}>{hint}</div>}
    </div>
  </label>;
}
function GovCheckbox({id,checked,onChange,label}){
  return<label htmlFor={id} style={{display:"flex",gap:12,cursor:"pointer",alignItems:"center",marginBottom:12}}>
    <input id={id} type="checkbox" checked={checked} onChange={onChange} style={{accentColor:G.green,width:24,height:24,flexShrink:0}}/>
    <span style={{fontSize:17}}>{label}</span>
  </label>;
}
function GovInset({children}){
  return<div style={{borderLeft:`6px solid ${G.green}`,paddingLeft:16,margin:"12px 0 20px",fontSize:15,lineHeight:1.6}}>{children}</div>;
}
function GovDetails({summary,children}){
  return<details style={{marginBottom:20,border:`1px solid ${G.border}`}}>
    <summary style={{padding:"10px 14px",cursor:"pointer",fontWeight:"bold",fontSize:15,color:G.link,background:G.bg,listStyle:"none"}}>▶ {summary}</summary>
    <div style={{padding:"14px 16px",fontSize:14,lineHeight:1.7,background:G.white}}>{children}</div>
  </details>;
}
function ErrorMsg({children}){return<div style={{color:G.error,fontWeight:"bold",fontSize:15,padding:"3px 0 6px"}}>⚠ {children}</div>;}
function Divider(){return<hr style={{border:"none",borderTop:`1px solid ${G.border}`,margin:"28px 0"}}/>;}
function SchemeTable({rows}){
  return<table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
    <thead><tr style={{background:G.greenDark,color:G.white}}>
      {["When you joined","Scheme","How it works"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left"}}>{h}</th>)}
    </tr></thead>
    <tbody>{rows.map((r,i)=>(
      <tr key={i} style={{background:i%2===0?G.white:G.bg,borderBottom:`1px solid ${G.border}`}}>
        {r.map((c,j)=><td key={j} style={{padding:"8px 12px",fontSize:13}}>{c}</td>)}
      </tr>
    ))}</tbody>
  </table>;
}
function Footer(){
  return<div style={{background:G.greenDark,color:"rgba(255,255,255,0.7)",padding:"20px 30px",fontSize:13}}>
    <div style={{maxWidth:960,margin:"0 auto",lineHeight:1.7}}>
      <strong style={{color:"rgba(255,255,255,0.9)"}}>Civil Service Pension Estimator</strong> · Independent informal tool · Not affiliated with HM Government, Cabinet Office or Capita · Output is not financial, pension or legal advice · Official calculations: <strong style={{color:"rgba(255,255,255,0.9)"}}>www.civilservicepensionscheme.org.uk</strong>
    </div>
  </div>;
}

const thStyle={padding:"10px 14px",textAlign:"left",fontWeight:"bold",fontSize:14,color:G.greenDark};
const sH2={fontSize:22,fontWeight:"bold",borderBottom:`2px solid ${G.green}`,paddingBottom:8,margin:"0 0 14px"};
const primaryBtn={background:G.green,color:G.white,border:"2px solid transparent",padding:"12px 24px",fontSize:18,fontWeight:"bold",fontFamily:G.font,cursor:"pointer"};
const backLink={background:"transparent",border:"none",color:G.link,fontSize:16,fontFamily:G.font,cursor:"pointer",textDecoration:"underline",padding:0};
const removeBtn={background:"transparent",border:`1px solid ${G.error}`,color:G.error,padding:"4px 12px",fontSize:13,fontFamily:G.font,cursor:"pointer"};
const addBtnSolid={background:G.green,border:`2px solid ${G.green}`,color:"white",padding:"10px 20px",fontSize:15,fontWeight:"bold",fontFamily:G.font,cursor:"pointer",marginTop:4};
const addBtnOutline={background:"transparent",border:`2px solid ${G.green}`,color:G.green,padding:"10px 20px",fontSize:15,fontWeight:"bold",fontFamily:G.font,cursor:"pointer",marginTop:4};
