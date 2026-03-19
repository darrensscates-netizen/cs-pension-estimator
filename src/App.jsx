import { useState } from "react";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const G = {
  green:       "#00703c",
  greenDark:   "#005a30",
  greenLight:  "#cce2d8",
  greenBorder: "#00703c",
  focus:       "#ffdd00",
  text:        "#0b0c0c",
  textSec:     "#505a5f",
  border:      "#b1b4b6",
  borderDark:  "#0b0c0c",
  bg:          "#f3f2f0",
  white:       "#ffffff",
  error:       "#d4351c",
  warning:     "#f47738",
  link:        "#1d70b8",
  font:        "'Arial','Helvetica Neue',Helvetica,sans-serif",
};

// ─── SCHEME DEFINITIONS ───────────────────────────────────────────────────────
const SCHEME_INFO = {
  classic:     { label:"Classic",      npa:60, minAge:50, type:"final_salary" },
  classicplus: { label:"Classic Plus", npa:60, minAge:50, type:"final_salary" },
  premium:     { label:"Premium",      npa:60, minAge:50, type:"final_salary" },
  nuvos:       { label:"Nuvos",        npa:65, minAge:55, type:"care" },
  alpha:       { label:"Alpha",        npa:null, minAge:55, type:"care" },
};

function getSPA(dob){
  if(!dob) return 67;
  const y=new Date(dob).getFullYear();
  return y<1960?65:y<1977?66:67;
}
function getAlphaNPA(dob){ return Math.max(65,getSPA(dob)); }
function getNPA(scheme,dob){
  return scheme==="alpha"?getAlphaNPA(dob):(SCHEME_INFO[scheme]?.npa??60);
}
function earlyFactor(scheme,yearsEarly){
  if(yearsEarly<=0) return 1;
  if(scheme==="alpha") return Math.max(0,1-0.04*yearsEarly);
  const y=Math.min(yearsEarly,20);
  return Math.max(0,1-(y<=3?y*0.05:0.15+(y-3)*0.04));
}

const CY=new Date().getFullYear();
const fmt=n=>"£"+Math.round(n).toLocaleString("en-GB");
const fmtPct=n=>(n*100).toFixed(1)+"%";

// ─── PERIOD TYPES ─────────────────────────────────────────────────────────────
// type: "service" | "break" | "transfer"
// service  – normal employment in a CS scheme
// break    – gap in service (affects final salary link if ≥5 years)
// transfer – pension transferred in from another scheme

function makePeriod(type="service"){
  return {
    id: Date.now()+Math.random(),
    type,
    // service fields
    scheme:"alpha", startYear:"", endYear:"present",
    classicYears:"", salaryInputs:[],
    // break fields
    breakStart:"", breakEnd:"",
    // transfer fields
    transferType:"club",          // "club" | "nonclub"
    transferScheme:"nuvos",       // which CS scheme it lands in
    serviceCredit:"",             // years of equivalent service (club transfer)
    annualPensionValue:"",        // £ annual pension bought (non-club transfer)
  };
}

export default function App(){
  const [disclaimerAccepted,setDisclaimerAccepted]=useState(false);
  const [disclaimerScrolled,setDisclaimerScrolled]=useState(false);
  const [disclaimerChecked,setDisclaimerChecked]=useState(false);

  const [step,setStep]=useState(0);
  const [errors,setErrors]=useState({});
  const [dob,setDob]=useState("");
  const [name,setName]=useState("");
  const [periods,setPeriods]=useState([makePeriod("service")]);
  const [finalSalary,setFinalSalary]=useState("");
  const [retAge,setRetAge]=useState("");
  const [basis,setBasis]=useState("normal");
  const [commute,setCommute]=useState(false);
  const [commuteAmt,setCommuteAmt]=useState("");
  const [results,setResults]=useState(null);

  // ── derived ──
  const servicePeriods = periods.filter(p=>p.type==="service");
  const breakPeriods   = periods.filter(p=>p.type==="break");
  const transferPeriods= periods.filter(p=>p.type==="transfer");

  const hasFinalSalary = servicePeriods.some(p=>["classic","classicplus","premium"].includes(p.scheme));
  const carePeriods    = servicePeriods.filter(p=>["nuvos","alpha"].includes(p.scheme)&&getYears(p)>0);
  const hasClubTransfer= transferPeriods.some(p=>p.transferType==="club");

  // longest break in years
  const longestBreak = breakPeriods.reduce((max,b)=>{
    const bs=parseInt(b.breakStart)||CY, be=parseInt(b.breakEnd)||CY;
    return Math.max(max, Math.max(0,be-bs));
  },0);
  const finalSalaryLinkLost = longestBreak>=5;

  function getYears(p){
    const ey=p.endYear==="present"?CY:(parseInt(p.endYear)||CY);
    const sy=parseInt(p.startYear)||CY;
    return Math.max(0,ey-sy);
  }

  function updatePeriod(id,field,val){
    setPeriods(ps=>ps.map(p=>{
      if(p.id!==id) return p;
      const up={...p,[field]:val};
      if(["scheme","startYear","endYear"].includes(field)){
        const sy=parseInt(field==="startYear"?val:up.startYear)||CY;
        const eyRaw=field==="endYear"?val:up.endYear;
        const ey=eyRaw==="present"?CY:(parseInt(eyRaw)||CY);
        const yrs=Math.max(0,ey-sy);
        if(["nuvos","alpha"].includes(up.scheme)){
          const ex=p.salaryInputs||[];
          up.salaryInputs=Array.from({length:yrs},(_,i)=>ex[i]??"");
        }
      }
      return up;
    }));
  }

  function updateSalaryInput(id,idx,val){
    setPeriods(ps=>ps.map(p=>{
      if(p.id!==id) return p;
      const arr=[...(p.salaryInputs||[])];
      arr[idx]=val;
      return {...p,salaryInputs:arr};
    }));
  }

  function addPeriod(type){ setPeriods(ps=>[...ps,makePeriod(type)]); }
  function removePeriod(id){ setPeriods(ps=>ps.filter(p=>p.id!==id)); }

  // ── validation ──
  function validate(){
    const e={};
    if(step===0){
      if(!dob) e.dob="Enter your date of birth";
    }
    if(step===1){
      periods.forEach((p,i)=>{
        if(p.type==="service"){
          if(!p.startYear) e[`sy_${i}`]="Enter a start year";
          if(p.scheme==="classicplus"&&!p.classicYears) e[`cy_${i}`]="Enter the Classic years";
          if(getYears(p)===0&&p.startYear) e[`yr_${i}`]="End year must be after start year";
        }
        if(p.type==="break"){
          if(!p.breakStart) e[`bs_${i}`]="Enter break start year";
          if(!p.breakEnd)   e[`be_${i}`]="Enter break end year";
          if(p.breakStart&&p.breakEnd&&parseInt(p.breakEnd)<=parseInt(p.breakStart))
            e[`be_${i}`]="End must be after start";
        }
        if(p.type==="transfer"){
          if(!p.serviceCredit&&p.transferType==="club")     e[`tc_${i}`]="Enter the service credit in years";
          if(!p.annualPensionValue&&p.transferType==="nonclub") e[`tv_${i}`]="Enter the annual pension amount";
        }
      });
    }
    if(step===2){
      if(hasFinalSalary&&!finalSalaryLinkLost&&(!finalSalary||isNaN(finalSalary)))
        e.fs="Enter your final pensionable salary";
      if(hasFinalSalary&&finalSalaryLinkLost&&(!finalSalary||isNaN(finalSalary)))
        e.fs="Enter your salary at the end of each period (use the salary at leaving for each pre-break period)";
      carePeriods.forEach(p=>{
        (p.salaryInputs||[]).forEach((s,i)=>{
          if(!s||isNaN(s)) e[`si_${p.id}_${i}`]="Required";
        });
      });
    }
    if(step===3){
      if(!retAge||isNaN(retAge)) e.ra="Enter your intended retirement age";
      else if(parseFloat(retAge)<50) e.ra="Minimum is 50 (55 for most members)";
      else if(parseFloat(retAge)>75) e.ra="Maximum is 75";
    }
    return e;
  }

  function next(){
    const e=validate();
    if(Object.keys(e).length){setErrors(e);return;}
    setErrors({});
    if(step===3) compute();
    setStep(s=>s+1);
  }
  function back(){ setErrors({}); setStep(s=>Math.max(0,s-1)); }

  // ── compute ──
  function compute(){
    const ra=parseFloat(retAge);
    const fs=parseFloat(finalSalary)||0;
    const spa=getSPA(dob);
    const aNPA=getAlphaNPA(dob);
    let totalUnreduced=0, totalAutoLump=0;
    const breakdown=[];

    // Service periods
    servicePeriods.forEach(p=>{
      const yrs=getYears(p);
      if(yrs===0) return;
      const npa=getNPA(p.scheme,dob);

      // If final salary link is lost (break ≥5 yrs), use salary at time of leaving
      // We use fs as the best proxy (user warned to enter leaving salary)
      let unreduced=0, autoLump=0;
      if(p.scheme==="classic"){
        unreduced=(fs*yrs)/80; autoLump=unreduced*3;
      } else if(p.scheme==="classicplus"){
        const cy=Math.min(parseFloat(p.classicYears)||0,yrs);
        const py=yrs-cy;
        unreduced=(fs*cy)/80+(fs*py)/60;
        autoLump=(fs*cy/80)*3;
      } else if(p.scheme==="premium"){
        unreduced=(fs*yrs)/60;
      } else if(p.scheme==="nuvos"){
        unreduced=(p.salaryInputs||[]).reduce((s,v)=>s+(parseFloat(v)||0)*0.023,0);
      } else if(p.scheme==="alpha"){
        unreduced=(p.salaryInputs||[]).reduce((s,v)=>s+(parseFloat(v)||0)*0.0232,0);
      }

      // If final salary link lost, deferred pension uprated by CPI
      // We note this in the breakdown but can't calculate exact CPI without dates
      // We flag it instead
      totalUnreduced+=unreduced;
      totalAutoLump+=autoLump;
      breakdown.push({
        label:`${SCHEME_INFO[p.scheme]?.label} (${p.startYear}–${p.endYear==="present"?"present":p.endYear})`,
        years:yrs, unreduced, autoLump, npa,
        deferred: false,
      });
    });

    // Transfer-in periods
    transferPeriods.forEach(p=>{
      if(p.transferType==="club"){
        const sc=parseFloat(p.serviceCredit)||0;
        if(sc===0) return;
        // Club transfer into nuvos: service credit × 1/60 × final salary (linked)
        // If final salary link lost, the transfer in is still linked to the salary
        // at time of transfer (which we approximate with fs)
        const unreduced=(fs*sc)/60;
        totalUnreduced+=unreduced;
        breakdown.push({
          label:`Club Transfer In → ${SCHEME_INFO[p.transferScheme]?.label} (${sc} yr credit)`,
          years:sc, unreduced, autoLump:0,
          npa: getNPA(p.transferScheme,dob),
          deferred:false, isTransfer:true,
        });
      } else {
        // Non-club: a fixed annual pension amount, uprated by CPI in deferment
        const pv=parseFloat(p.annualPensionValue)||0;
        if(pv===0) return;
        totalUnreduced+=pv;
        breakdown.push({
          label:`Non-Club Transfer In → ${SCHEME_INFO[p.transferScheme]?.label} (fixed pension)`,
          years:null, unreduced:pv, autoLump:0,
          npa: getNPA(p.transferScheme,dob),
          deferred:false, isTransfer:true,
        });
      }
    });

    const dominantScheme=servicePeriods.some(p=>p.scheme==="alpha")?"alpha"
      :servicePeriods.some(p=>p.scheme==="nuvos")?"nuvos":"classic";
    const primaryNPA=getNPA(dominantScheme,dob);

    let factor=1, yearsEarly=0;
    if(basis==="early"){
      yearsEarly=Math.max(0,primaryNPA-ra);
      factor=earlyFactor(dominantScheme,yearsEarly);
    }

    let pension=totalUnreduced*factor;
    if(basis==="ill_health_upper"){
      const totalYrs=servicePeriods.reduce((s,p)=>s+getYears(p),0);
      const avg=totalYrs>0?totalUnreduced/totalYrs:0;
      pension+=avg*Math.max(0,primaryNPA-ra);
    }

    let commuteGiveUp=0, lumpFromCommute=0;
    if(commute&&commuteAmt&&!isNaN(commuteAmt)){
      commuteGiveUp=Math.min(parseFloat(commuteAmt),pension);
      lumpFromCommute=commuteGiveUp*12;
      pension-=commuteGiveUp;
    }

    setResults({
      pension, monthly:pension/12,
      totalLump:totalAutoLump+lumpFromCommute,
      totalAutoLump, lumpFromCommute,
      totalUnreduced, factor, yearsEarly, primaryNPA,
      spa, aNPA, ra, basis, breakdown,
      finalSalaryLinkLost, longestBreak,
      hasBreaks: breakPeriods.length>0,
      hasTransfers: transferPeriods.length>0,
    });
  }

  function yearLabel(period,idx){
    const sy=parseInt(period.startYear)||CY;
    return `${sy+idx}–${sy+idx+1}`;
  }

  const stepTitles=["About you","Career history","Salary details","Retirement plans","Your estimate"];

  // ── Disclaimer gate ──
  if(!disclaimerAccepted){
    return(
      <div style={{fontFamily:G.font,background:G.bg,minHeight:"100vh",color:G.text}}>
        <div style={{background:G.green}}>
          <div style={{maxWidth:960,margin:"0 auto",padding:"0 30px"}}>
            <div style={{padding:"14px 0 10px",display:"flex",alignItems:"center",gap:14,borderBottom:"1px solid rgba(255,255,255,0.3)"}}>
              <div style={{background:"white",color:G.green,fontWeight:"900",fontSize:15,padding:"4px 8px",letterSpacing:-0.5}}>CS</div>
              <span style={{color:"white",fontSize:18,fontWeight:"bold"}}>Civil Service Pension Estimator</span>
            </div>
            <div style={{padding:"8px 0 12px",fontSize:14,color:"rgba(255,255,255,0.85)"}}>
              Informal estimation tool — not an official Civil Service Pensions service
            </div>
          </div>
        </div>

        <div style={{maxWidth:680,margin:"0 auto",padding:"40px 30px 80px"}}>
          <div style={{background:"#fff4e5",border:`4px solid ${G.warning}`,padding:"16px 20px",marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <span style={{fontSize:22}}>⚠</span>
              <strong style={{fontSize:18}}>IMPORTANT — Please read before continuing</strong>
            </div>
            <p style={{margin:"0 0 6px",fontSize:14,fontWeight:"bold",color:G.error}}>
              THIS IS NOT AN OFFICIAL GOVERNMENT OR CIVIL SERVICE PENSIONS SERVICE
            </p>
            <p style={{margin:"0 0 6px",fontSize:14,fontWeight:"bold",color:G.error}}>
              NOTHING ON THIS TOOL CONSTITUTES FINANCIAL, PENSION, LEGAL OR ANY OTHER PROFESSIONAL ADVICE
            </p>
          </div>

          <h1 style={{fontSize:28,fontWeight:"bold",borderBottom:`4px solid ${G.green}`,paddingBottom:12,marginBottom:20}}>
            Important Disclaimer and Terms of Use
          </h1>

          <div
            onScroll={e=>{
              const el=e.target;
              if(el.scrollHeight-el.scrollTop-el.clientHeight<30) setDisclaimerScrolled(true);
            }}
            style={{
              height:380,overflowY:"scroll",border:`2px solid ${G.border}`,
              background:G.white,padding:"20px 24px",marginBottom:20,
              fontSize:14,lineHeight:1.8,
            }}
          >
            <h2 style={{fontSize:18,fontWeight:"bold",marginTop:0}}>1. Nature of this tool</h2>
            <p>This Civil Service Pension Estimator ("the Tool") is an <strong>independent, informal estimation tool</strong>. It is not affiliated with, endorsed by, or connected to HM Government, the Cabinet Office, Civil Service Pensions, the Scheme Administrator (Capita), or any other official body. It is not part of the Civil Service Pension Scheme website or any official government service.</p>

            <h2 style={{fontSize:18,fontWeight:"bold"}}>2. Not financial, pension or legal advice</h2>
            <p>The output produced by this Tool is <strong>an estimate only</strong>. Nothing produced by or contained within this Tool constitutes:</p>
            <ul>
              <li>Financial advice of any kind;</li>
              <li>Pension advice of any kind;</li>
              <li>Legal advice of any kind;</li>
              <li>Actuarial advice of any kind; or</li>
              <li>Any other form of professional advice.</li>
            </ul>
            <p>You should not make any retirement, financial or employment decision based solely or primarily on the output of this Tool. Before making any such decision you should obtain a formal benefit statement from the Scheme Administrator and, where appropriate, take independent regulated financial advice from a suitably qualified financial adviser authorised by the Financial Conduct Authority (FCA).</p>

            <h2 style={{fontSize:18,fontWeight:"bold"}}>3. Accuracy and limitations</h2>
            <p>Estimates are based on publicly available Civil Service Pension Scheme rules as understood at the time this Tool was last updated. The Tool does <strong>not</strong> account for, among other things:</p>
            <ul>
              <li>The McCloud/2015 Remedy and Deferred Choice Underpin;</li>
              <li>Added Pension or Additional Voluntary Contribution (AVC) top-ups;</li>
              <li>Exact Consumer Prices Index (CPI) uprating on deferred pensions;</li>
              <li>Pension sharing orders arising from divorce or dissolution of civil partnership;</li>
              <li>Abatement rules;</li>
              <li>Partial retirement scenarios;</li>
              <li>Early Payment Age (EPA) or Enhanced Early Payment Age (EEPA) arrangements;</li>
              <li>Club transfer factors as set by the Government Actuary's Department;</li>
              <li>Future changes to State Pension Age or scheme rules; or</li>
              <li>Individual circumstances that may affect your entitlement.</li>
            </ul>
            <p>Early retirement reduction factors used in this Tool are <strong>indicative only</strong>. Actual factors are set periodically by the Government Actuary's Department and may differ materially from those used here.</p>
            <p>The Tool uses simplified calculation methods. Your actual pension will be calculated by the Scheme Administrator using verified payroll data, full service records and the precise scheme regulations in force at your retirement date.</p>

            <h2 style={{fontSize:18,fontWeight:"bold"}}>4. No liability</h2>
            <p>To the fullest extent permitted by applicable law, the operator of this Tool accepts <strong>no liability whatsoever</strong> for any loss, damage, cost or expense of any nature (whether direct, indirect, consequential or otherwise) arising from your use of or reliance on this Tool or its outputs. This includes but is not limited to financial loss, loss of pension entitlement, or any decision made in reliance on an estimate produced by this Tool.</p>

            <h2 style={{fontSize:18,fontWeight:"bold"}}>5. No data collection</h2>
            <p>This Tool operates entirely within your browser. No personal data, salary information or pension details entered into this Tool are transmitted to any server, stored, or shared with any third party. All calculations are performed locally on your device and no information is retained after you close or refresh the page.</p>

            <h2 style={{fontSize:18,fontWeight:"bold"}}>6. Official sources</h2>
            <p>For an official pension estimate you should use the <strong>Retirement Modeller</strong> on the Civil Service Pension Portal at <strong>www.civilservicepensionscheme.org.uk</strong>. For formal benefit statements, contact the Scheme Administrator. For regulated financial advice, consult an FCA-authorised financial adviser. You can find one at <strong>www.moneyhelper.org.uk</strong>.</p>

            <h2 style={{fontSize:18,fontWeight:"bold"}}>7. Intellectual property</h2>
            <p>This Tool uses a design style inspired by the GOV.UK Design System. It is not an official government service and does not claim to be. The GOV.UK Design System is used under the MIT licence.</p>

            <p style={{fontStyle:"italic",color:G.textSec,marginTop:24,borderTop:`1px solid ${G.border}`,paddingTop:16}}>
              Scroll to the bottom of this disclaimer to proceed. By ticking the box below and clicking "I understand and agree", you confirm that you have read, understood and agree to these terms, and that you will not treat any output of this Tool as financial, pension or legal advice.
            </p>
          </div>

          {!disclaimerScrolled&&(
            <p style={{color:G.textSec,fontSize:14,margin:"0 0 16px",fontStyle:"italic"}}>
              ↑ Please scroll to the bottom of the disclaimer above to continue.
            </p>
          )}

          {disclaimerScrolled&&(
            <>
              <label style={{display:"flex",gap:12,alignItems:"flex-start",cursor:"pointer",marginBottom:20,background:disclaimerChecked?G.greenLight:"white",border:`2px solid ${disclaimerChecked?G.greenBorder:G.border}`,padding:"14px 16px"}}>
                <input type="checkbox" checked={disclaimerChecked} onChange={e=>setDisclaimerChecked(e.target.checked)}
                  style={{accentColor:G.green,width:22,height:22,flexShrink:0,marginTop:2}}/>
                <span style={{fontSize:15,lineHeight:1.6}}>
                  <strong>I have read and understood the disclaimer above.</strong> I confirm that I will not treat any output of this Tool as financial, pension, legal or any other professional advice, and that I understand this is not an official Civil Service Pensions service.
                </span>
              </label>

              <button
                onClick={()=>{ if(disclaimerChecked) setDisclaimerAccepted(true); }}
                disabled={!disclaimerChecked}
                style={{
                  background:disclaimerChecked?G.green:"#b1b4b6",
                  color:"white",border:"none",padding:"14px 28px",
                  fontSize:17,fontWeight:"bold",fontFamily:G.font,
                  cursor:disclaimerChecked?"pointer":"not-allowed",
                  opacity:disclaimerChecked?1:0.7,
                }}>
                I understand and agree — continue to the estimator
              </button>
            </>
          )}
        </div>

        <div style={{background:G.greenDark,color:"rgba(255,255,255,0.7)",padding:"20px 30px",fontSize:13}}>
          <div style={{maxWidth:960,margin:"0 auto"}}>
            Civil Service Pension Estimator · Independent informal tool · Not an official Civil Service Pensions service · Not financial, pension or legal advice
          </div>
        </div>
      </div>
    );
  }

  return(
    <div style={{fontFamily:G.font,background:G.bg,minHeight:"100vh",color:G.text}}>

      {/* HEADER */}
      <div style={{background:G.green}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 30px"}}>
          <div style={{padding:"14px 0 10px",display:"flex",alignItems:"center",gap:14,borderBottom:"1px solid rgba(255,255,255,0.3)"}}>
            <div style={{background:"white",color:G.green,fontWeight:"900",fontSize:15,padding:"4px 8px",letterSpacing:-0.5}}>CS</div>
            <span style={{color:"white",fontSize:18,fontWeight:"bold"}}>Civil Service Pension Estimator</span>
          </div>
          <div style={{padding:"8px 0 12px",fontSize:14,color:"rgba(255,255,255,0.85)"}}>
            Informal guide to your Civil Service pension — not an official calculation
          </div>
        </div>
      </div>

      {/* PERSISTENT DISCLAIMER BANNER */}
      <div style={{background:"#fff4e5",borderBottom:`3px solid ${G.warning}`,padding:"10px 30px"}}>
        <div style={{maxWidth:960,margin:"0 auto",fontSize:13,color:"#594000",display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
          <span style={{fontWeight:"bold",whiteSpace:"nowrap"}}>⚠ Not an official service.</span>
          <span>This tool produces <strong>estimates only</strong> and does not constitute financial, pension or legal advice. For an official calculation use the <strong>Civil Service Pension Portal</strong>. Always consult a regulated financial adviser before making retirement decisions.</span>
        </div>
      </div>

      {/* STEP NAV */}
      <div style={{background:G.greenDark,borderBottom:`4px solid ${G.green}`}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 30px",display:"flex",overflowX:"auto"}}>
          {stepTitles.map((t,i)=>(
            <div key={i} style={{
              padding:"10px 16px 8px",fontSize:13,whiteSpace:"nowrap",
              fontWeight:i===step?"bold":"normal",
              color:i===step?G.focus:i<step?G.greenLight:"rgba(255,255,255,0.45)",
              borderBottom:i===step?`4px solid ${G.focus}`:"4px solid transparent",
              marginBottom:-4,
            }}>
              {i<step?"✓ ":`${i+1}. `}{t}
            </div>
          ))}
        </div>
      </div>

      <div style={{maxWidth:680,margin:"0 auto",padding:"40px 30px 80px"}}>

        {/* ══ STEP 0: About you ══ */}
        {step===0&&<>
          <H1>About you</H1>
          <GovHint>We use your date of birth to determine your Normal Pension Age for each scheme.</GovHint>
          <GovField label="Full name (optional)" id="name" hint="Used only to personalise your results">
            <GovInput id="name" value={name} onChange={e=>setName(e.target.value)} width={300} placeholder="e.g. Jane Smith"/>
          </GovField>
          <GovField label="Date of birth" id="dob" error={errors.dob} required>
            <GovInput id="dob" type="date" value={dob} onChange={e=>setDob(e.target.value)} width={220} error={!!errors.dob}/>
          </GovField>
          {dob&&(
            <GovInset>
              <strong>Your Normal Pension Ages:</strong>
              <ul style={{margin:"6px 0 0",paddingLeft:20,lineHeight:1.8}}>
                <li>Classic / Premium: <strong>60</strong></li>
                <li>Nuvos: <strong>65</strong></li>
                <li>Alpha: <strong>{getAlphaNPA(dob)}</strong> (greater of State Pension Age {getSPA(dob)} or 65)</li>
              </ul>
            </GovInset>
          )}
          <GovDetails summary="Which scheme am I in?">
            <SchemeTable rows={[
              ["Before 1 October 2002","Classic","1/80th final salary per year + automatic 3× lump sum"],
              ["Oct 2002 – Jul 2007 (new entrant)","Premium","1/60th final salary per year (no automatic lump sum)"],
              ["Joined pre-Oct 2002, continued past Oct 2002","Classic Plus","Classic rules to Sep 2002, Premium rules after"],
              ["30 Jul 2007 – 31 Mar 2015","Nuvos","2.3% of each year's actual pay built up year by year"],
              ["1 April 2015 onwards","Alpha","2.32% of each year's actual pay built up year by year"],
            ]}/>
          </GovDetails>
        </>}

        {/* ══ STEP 1: Career history ══ */}
        {step===1&&<>
          <H1>Your career history</H1>
          <GovHint>
            Build up your full pension picture by adding employment periods, breaks in service, and any pensions you have transferred in. Use the buttons at the bottom to add each type.
          </GovHint>

          {/* Summary of what's been added */}
          {(breakPeriods.length>0||transferPeriods.length>0)&&(
            <div style={{background:G.greenLight,border:`1px solid ${G.greenBorder}`,padding:"10px 14px",marginBottom:20,fontSize:14}}>
              {breakPeriods.length>0&&<span>📅 {breakPeriods.length} break{breakPeriods.length>1?"s":""} in service added</span>}
              {breakPeriods.length>0&&transferPeriods.length>0&&<span style={{margin:"0 10px"}}>·</span>}
              {transferPeriods.length>0&&<span>🔄 {transferPeriods.length} transfer{transferPeriods.length>1?"s":""} added</span>}
              {finalSalaryLinkLost&&(
                <div style={{marginTop:6,color:G.error,fontWeight:"bold"}}>
                  ⚠ Break of {longestBreak} years detected — the final salary link to Classic/Premium benefits may be lost for periods before the break.
                </div>
              )}
            </div>
          )}

          {periods.map((p,i)=>{
            if(p.type==="service") return(
              <ServicePeriodCard key={p.id} p={p} i={i} dob={dob} errors={errors}
                updatePeriod={updatePeriod} removePeriod={removePeriod}
                canRemove={periods.length>1} getYears={getYears}/>
            );
            if(p.type==="break") return(
              <BreakCard key={p.id} p={p} i={i} errors={errors}
                updatePeriod={updatePeriod} removePeriod={removePeriod}/>
            );
            if(p.type==="transfer") return(
              <TransferCard key={p.id} p={p} i={i} errors={errors}
                updatePeriod={updatePeriod} removePeriod={removePeriod}/>
            );
            return null;
          })}

          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:8}}>
            <button onClick={()=>addPeriod("service")} style={addBtnStyle}>+ Add employment period</button>
            <button onClick={()=>addPeriod("break")} style={addBtnStyleOutline}>+ Add break in service</button>
            <button onClick={()=>addPeriod("transfer")} style={addBtnStyleOutline}>+ Add transfer in</button>
          </div>

          <GovDetails summary="What counts as a break in service?">
            <p style={{marginTop:0}}>A break in service is any gap between two periods of Civil Service employment — for example, if you left the Civil Service and worked in the private sector before returning. Key rules:</p>
            <ul style={{lineHeight:1.8}}>
              <li><strong>Break of less than 28 days</strong> — usually treated as continuous service.</li>
              <li><strong>Break of 28 days to under 5 years</strong> — you can often aggregate (join up) the two periods of service. The final salary link is kept.</li>
              <li><strong>Break of 5 years or more</strong> — the final salary link to Classic, Classic Plus or Premium is lost. Pre-break benefits become a deferred pension based on your salary at leaving, uprated by CPI during the break. Post-break service is calculated independently.</li>
            </ul>
          </GovDetails>

          <GovDetails summary="What is a transfer in?">
            <p style={{marginTop:0}}>If you previously worked somewhere else and built up a pension there, you may have transferred it into your Civil Service pension. There are two types:</p>
            <ul style={{lineHeight:1.8}}>
              <li><strong>Club transfer</strong> — from another public sector scheme in the Public Sector Transfer Club (e.g. NHS, teachers, local government). Buys a <em>service credit</em> (years of equivalent service) in nuvos, linked to your final salary.</li>
              <li><strong>Non-Club transfer</strong> — from a private pension or non-Club scheme. Buys a fixed amount of annual pension (a "transfer credit"), uprated by CPI. Not linked to final salary.</li>
            </ul>
            <p>Your transfer paperwork or Annual Benefit Statement will confirm what type it was and the credit received.</p>
          </GovDetails>
        </>}

        {/* ══ STEP 2: Salary details ══ */}
        {step===2&&<>
          <H1>Your salary details</H1>

          {finalSalaryLinkLost&&(
            <div style={{background:"#fff4e5",borderLeft:`8px solid ${G.warning}`,padding:"14px 18px",marginBottom:20,fontSize:14,lineHeight:1.7}}>
              <strong>Break of 5 or more years detected</strong>
              <p style={{margin:"6px 0 0"}}>
                Because you had a break of <strong>{longestBreak} years</strong>, the final salary link for Classic/Premium service before the break is lost. Those benefits became a <em>deferred pension</em> fixed at your salary when you left, uprated annually by CPI during the break. Enter the salary you were on when you left for each pre-break period. For post-break final salary periods, enter the salary at the later leaving date or at retirement.
              </p>
            </div>
          )}

          {hasFinalSalary&&<>
            <h2 style={sectionH2}>Final salary schemes (Classic, Classic Plus, Premium)</h2>
            <GovHint>
              {finalSalaryLinkLost
                ? "Because your final salary link was lost, enter the salary at the time you left each period. This calculator uses a single salary value — if your pre- and post-break salaries differed significantly, use your leaving salary for the main period."
                : "Your pension for Classic, Classic Plus and Premium is based on your salary when you retire or leave. This applies to all your final-salary service, no matter how long ago it was built up."}
            </GovHint>
            <GovField label={finalSalaryLinkLost?"Salary at time of leaving final salary employment":"Final pensionable salary"} id="fs" required error={errors.fs}
              hint="Basic salary. Include permanent pensionable allowances. Exclude overtime, ad-hoc bonuses and non-pensionable allowances.">
              <PoundInput id="fs" value={finalSalary} onChange={e=>setFinalSalary(e.target.value)} error={!!errors.fs}/>
            </GovField>
            {carePeriods.length>0&&<Divider/>}
          </>}

          {carePeriods.length>0&&<>
            <h2 style={sectionH2}>Career average schemes (Nuvos and Alpha)</h2>
            <GovHint>
              For Nuvos and Alpha your pension is the sum of <strong>2.3% (Nuvos) or 2.32% (Alpha) of each individual year's actual pay</strong>. Enter the salary for each April-to-March scheme year. Check your Annual Benefit Statements or payslips if unsure.
            </GovHint>

            {carePeriods.map(p=>{
              const yrs=getYears(p);
              const rate=p.scheme==="nuvos"?0.023:0.0232;
              const rateLabel=p.scheme==="nuvos"?"2.3%":"2.32%";
              const runningTotal=(p.salaryInputs||[]).reduce((s,v)=>s+(parseFloat(v)||0)*rate,0);
              return(
                <div key={p.id} style={{marginBottom:32}}>
                  <h3 style={{fontSize:18,fontWeight:"bold",color:G.greenDark,margin:"0 0 4px"}}>
                    {SCHEME_INFO[p.scheme].label} · {p.startYear} to {p.endYear==="present"?"present":p.endYear}
                  </h3>
                  <p style={{fontSize:14,color:G.textSec,margin:"0 0 14px"}}>
                    Pension = {rateLabel} of each year's pensionable pay, summed across all years
                  </p>
                  <div style={{border:`1px solid ${G.border}`,background:G.white}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:15}}>
                      <thead>
                        <tr style={{background:G.greenLight,borderBottom:`2px solid ${G.greenBorder}`}}>
                          <th style={thStyle}>Year</th>
                          <th style={thStyle}>Pensionable pay</th>
                          <th style={{...thStyle,color:G.textSec,fontWeight:"normal",fontSize:13}}>Pension earned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({length:yrs},(_,idx)=>{
                          const sal=parseFloat(p.salaryInputs?.[idx])||0;
                          const earned=sal*rate;
                          const ek=`si_${p.id}_${idx}`;
                          return(
                            <tr key={idx} style={{borderTop:`1px solid ${G.border}`,background:idx%2===0?G.white:"#fafafa"}}>
                              <td style={{padding:"10px 14px",fontWeight:"bold",width:110}}>{yearLabel(p,idx)}</td>
                              <td style={{padding:"8px 14px"}}>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <span style={{fontSize:16}}>£</span>
                                  <input type="number" value={p.salaryInputs?.[idx]??""}
                                    onChange={e=>updateSalaryInput(p.id,idx,e.target.value)}
                                    placeholder="e.g. 35000"
                                    style={{border:`2px solid ${errors[ek]?G.error:G.border}`,padding:"7px 10px",fontSize:15,width:160,fontFamily:G.font,outline:"none"}}/>
                                </div>
                                {errors[ek]&&<div style={{color:G.error,fontSize:13,marginTop:4}}>Enter a salary for this year</div>}
                              </td>
                              <td style={{padding:"10px 14px",color:sal>0?G.greenDark:G.textSec,fontWeight:sal>0?"bold":"normal"}}>
                                {sal>0?fmt(earned)+"/yr":"—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{background:G.greenLight,borderTop:`2px solid ${G.greenBorder}`}}>
                          <td style={{padding:"10px 14px",fontWeight:"bold"}}>Total</td>
                          <td style={{padding:"10px 14px",color:G.textSec,fontSize:13}}>
                            {(p.salaryInputs||[]).filter(Boolean).length} of {yrs} entered
                          </td>
                          <td style={{padding:"10px 14px",fontWeight:"bold",color:G.greenDark}}>{fmt(runningTotal)}/yr</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <GovDetails summary="I don't have exact figures for every year">
                    <p style={{marginTop:0}}>Your <strong>Annual Benefit Statements</strong> show each year's accrued pension — from this you can back-calculate the salary. Your <strong>P60</strong> or payslips will also have each year's gross earnings. If estimating, a small difference has limited impact on the overall total.</p>
                  </GovDetails>
                </div>
              );
            })}
          </>}

          {hasClubTransfer&&<>
            <Divider/>
            <h2 style={sectionH2}>Club transfer — salary link</h2>
            <GovHint>
              Your Club transfer bought a <em>service credit</em> in nuvos, linked to your final salary (1/60th × service credit × final salary). If you have already entered a final pensionable salary above, that value will be used automatically. No additional input is needed here.
            </GovHint>
            <GovInset>
              Club transfer service credits are calculated using <strong>1/60th of your final salary × years of credit</strong>. This will be included in the results automatically using the final salary you entered above.
            </GovInset>
          </>}
        </>}

        {/* ══ STEP 3: Retirement plans ══ */}
        {step===3&&<>
          <H1>Retirement plans</H1>

          <GovField label="Intended retirement age" id="ra" required error={errors.ra}
            hint={dob?`Alpha NPA: ${getAlphaNPA(dob)} · Classic/Premium NPA: 60 · Nuvos NPA: 65 · Minimum: 55 (50 if joined Classic before 6 April 2006)`:""}>
            <GovInput id="ra" type="number" min="50" max="75" value={retAge}
              onChange={e=>setRetAge(e.target.value)} width={100} placeholder="e.g. 67" error={!!errors.ra}/>
          </GovField>

          <Divider/>
          <h2 style={sectionH2}>Retirement basis</h2>

          {[
            {val:"normal",label:"Normal or late retirement",
              hint:"Retiring at or after your Normal Pension Age. Your full pension is paid with no reduction."},
            {val:"early",label:"Voluntary early retirement",
              hint:"Retiring before your NPA. An actuarial reduction applies for life: ~4% per year early (Alpha); ~5% for the first 3 years then 4% thereafter (Classic, Premium, Nuvos)."},
            {val:"ill_health_lower",label:"Ill-health retirement — Lower Tier",
              hint:"The Scheme Medical Adviser has confirmed you cannot carry out your current role again before NPA. Full accrued pension with no early payment reduction."},
            {val:"ill_health_upper",label:"Ill-health retirement — Upper Tier",
              hint:"The Scheme Medical Adviser has confirmed you cannot carry out any gainful employment before NPA. Full pension plus enhancement: average annual accrual × remaining years to NPA."},
          ].map(opt=>(
            <GovRadio key={opt.val} name="basis" value={opt.val}
              checked={basis===opt.val} onChange={()=>setBasis(opt.val)}
              label={opt.label} hint={opt.hint}/>
          ))}

          <Divider/>
          <h2 style={sectionH2}>Pension commutation (optional)</h2>
          <GovHint>
            Exchange some annual pension for a larger tax-free lump sum at retirement. Rate: <strong>£12 lump sum per £1 of pension given up</strong>. Classic members also get an automatic 3× lump sum on top.
          </GovHint>
          <GovCheckbox id="commute" checked={commute} onChange={e=>setCommute(e.target.checked)}
            label="I want to commute additional pension into a lump sum"/>
          {commute&&(
            <div style={{paddingLeft:36,marginTop:8}}>
              <GovField label="Annual pension to give up (£ per year)" id="commuteAmt"
                hint="Every £1 given up = £12 lump sum.">
                <PoundInput id="commuteAmt" value={commuteAmt} onChange={e=>setCommuteAmt(e.target.value)}/>
              </GovField>
              {commuteAmt&&!isNaN(commuteAmt)&&parseFloat(commuteAmt)>0&&(
                <GovInset>
                  Additional lump sum: <strong>{fmt(parseFloat(commuteAmt)*12)}</strong><br/>
                  Annual pension reduced by: <strong>{fmt(parseFloat(commuteAmt))}/year</strong>
                </GovInset>
              )}
            </div>
          )}
        </>}

        {/* ══ STEP 4: Results ══ */}
        {step===4&&results&&<>
          <H1>{name?`${name}'s pension estimate`:"Your pension estimate"}</H1>

          <div style={{background:G.green,color:G.white,padding:"22px 24px",marginBottom:20}}>
            <div style={{fontSize:14,marginBottom:6,opacity:0.9}}>Estimated annual pension (before tax)</div>
            <div style={{fontSize:46,fontWeight:"bold",lineHeight:1,marginBottom:6}}>{fmt(results.pension)}</div>
            <div style={{fontSize:18,opacity:0.9}}>{fmt(results.monthly)} per month</div>
          </div>

          {results.totalLump>0&&(
            <div style={{background:G.greenLight,border:`2px solid ${G.greenBorder}`,padding:"16px 20px",marginBottom:20}}>
              <div style={{fontSize:14,color:G.textSec,marginBottom:4}}>Tax-free lump sum</div>
              <div style={{fontSize:32,fontWeight:"bold",color:G.greenDark}}>{fmt(results.totalLump)}</div>
              <div style={{fontSize:13,color:G.textSec,marginTop:4}}>
                {results.totalAutoLump>0&&`Automatic Classic lump sum: ${fmt(results.totalAutoLump)}`}
                {results.totalAutoLump>0&&results.lumpFromCommute>0&&" + "}
                {results.lumpFromCommute>0&&`From commutation: ${fmt(results.lumpFromCommute)}`}
              </div>
            </div>
          )}

          {results.yearsEarly>0&&results.basis==="early"&&(
            <div style={{background:"#fff7e6",borderLeft:`8px solid ${G.warning}`,padding:"14px 18px",marginBottom:20}}>
              <strong>Early retirement reduction applied</strong>
              <p style={{margin:"6px 0 0",fontSize:14,lineHeight:1.6}}>
                Retiring {results.yearsEarly.toFixed(1)} years before NPA ({results.primaryNPA}). Actuarial reduction: <strong>{fmtPct(1-results.factor)}</strong> — permanent for life. Unreduced pension would have been <strong>{fmt(results.totalUnreduced)}</strong>.
              </p>
            </div>
          )}

          {results.finalSalaryLinkLost&&(
            <div style={{background:"#fff4e5",borderLeft:`8px solid ${G.warning}`,padding:"14px 18px",marginBottom:20,fontSize:14,lineHeight:1.7}}>
              <strong>Note: final salary link was lost due to break in service of {results.longestBreak} years</strong>
              <p style={{margin:"6px 0 0"}}>
                Classic/Premium benefits built up before a break of 5 or more years are treated as a deferred pension, fixed at your salary at leaving and uprated by CPI during the break. This estimate uses the salary you entered. The actual amount depends on the CPI uprating applied during your specific break, which the Scheme Administrator will calculate precisely.
              </p>
            </div>
          )}

          <h2 style={{...sectionH2,marginTop:28}}>How your pension is built up</h2>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:15,marginBottom:24}}>
            <thead>
              <tr style={{background:G.greenDark,color:G.white}}>
                {["Component","Service","Annual pension (unreduced)","Auto lump sum","NPA"].map(h=>(
                  <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:13}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.breakdown.map((b,i)=>(
                <tr key={i} style={{background:i%2===0?G.white:G.bg,borderBottom:`1px solid ${G.border}`}}>
                  <td style={{padding:"10px 12px",fontWeight:"bold"}}>
                    {b.isTransfer&&<span style={{fontSize:11,background:G.link,color:"white",padding:"2px 6px",borderRadius:2,marginRight:6}}>TRANSFER</span>}
                    {b.label}
                  </td>
                  <td style={{padding:"10px 12px"}}>{b.years!=null?`${b.years} yr${b.years!==1?"s":""}`:""}</td>
                  <td style={{padding:"10px 12px"}}>{fmt(b.unreduced)}</td>
                  <td style={{padding:"10px 12px"}}>{b.autoLump>0?fmt(b.autoLump):"—"}</td>
                  <td style={{padding:"10px 12px"}}>{b.npa}</td>
                </tr>
              ))}
              <tr style={{background:G.greenLight,borderTop:`2px solid ${G.greenBorder}`,fontWeight:"bold"}}>
                <td style={{padding:"10px 12px"}}>Total (before any reduction)</td>
                <td></td>
                <td style={{padding:"10px 12px"}}>{fmt(results.totalUnreduced)}</td>
                <td style={{padding:"10px 12px"}}>{results.totalAutoLump>0?fmt(results.totalAutoLump):"—"}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <h2 style={sectionH2}>Key figures</h2>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:15,marginBottom:28}}>
            <tbody>
              {[
                ["Planned retirement age",results.ra],
                ["State Pension Age",results.spa],
                ["Alpha Normal Pension Age",results.aNPA],
                ["Early retirement reduction",results.factor<1?fmtPct(1-results.factor):"None"],
                ["Retirement basis",{normal:"Normal / late retirement",early:"Voluntary early retirement",ill_health_lower:"Ill-health — Lower Tier",ill_health_upper:"Ill-health — Upper Tier"}[results.basis]],
                results.hasBreaks?["Longest break in service",`${results.longestBreak} year${results.longestBreak!==1?"s":""} ${results.finalSalaryLinkLost?"(final salary link lost)":"(final salary link retained)"}`]:null,
                results.hasTransfers?["Transfer ins",`${transferPeriods.length} transfer${transferPeriods.length>1?"s":""} included`]:null,
                results.lumpFromCommute>0?["Pension commuted to lump sum",fmt(results.lumpFromCommute/12)+"/yr → "+fmt(results.lumpFromCommute)+" lump sum"]:null,
              ].filter(Boolean).map(([k,v],i)=>(
                <tr key={k} style={{background:i%2===0?G.white:G.bg,borderBottom:`1px solid ${G.border}`}}>
                  <th style={{padding:"10px 14px",textAlign:"left",fontWeight:"bold",width:"55%",borderRight:`1px solid ${G.border}`}}>{k}</th>
                  <td style={{padding:"10px 14px"}}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{background:"#fff4e5",border:`3px solid ${G.warning}`,padding:"20px 24px",fontSize:14,lineHeight:1.8,marginBottom:24}}>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
              <span style={{fontSize:20}}>⚠</span>
              <strong style={{fontSize:17,color:G.error}}>IMPORTANT DISCLAIMER — READ BEFORE ACTING ON THESE FIGURES</strong>
            </div>

            <p style={{margin:"0 0 10px",fontWeight:"bold",color:G.error}}>
              THIS IS NOT AN OFFICIAL CIVIL SERVICE PENSIONS CALCULATION. THIS IS NOT FINANCIAL, PENSION OR LEGAL ADVICE.
            </p>

            <p style={{margin:"0 0 10px"}}>
              This estimate is produced by an <strong>independent informal tool</strong> and is not affiliated with HM Government, the Cabinet Office, Civil Service Pensions, or the Scheme Administrator (Capita). It has no official standing and <strong>must not be treated as a formal benefit statement</strong>.
            </p>

            <p style={{margin:"0 0 10px"}}>
              <strong>Do not make any retirement, financial or employment decision based solely or primarily on this estimate.</strong> Your actual pension entitlement will depend on your verified service and payroll records and will be calculated by the Scheme Administrator under the precise scheme regulations in force at your retirement date. The figures shown here may differ materially from your actual entitlement.
            </p>

            <p style={{margin:"0 0 10px"}}>This estimate does <strong>not</strong> account for:</p>
            <ul style={{margin:"0 0 10px",paddingLeft:20}}>
              <li>The McCloud/2015 Remedy and Deferred Choice Underpin</li>
              <li>Added Pension or Additional Voluntary Contributions (AVCs)</li>
              <li>Exact CPI uprating applied to deferred pensions during breaks in service</li>
              <li>Pension sharing orders arising from divorce or dissolution of civil partnership</li>
              <li>Abatement rules on re-employment</li>
              <li>Early Payment Age (EPA) or Enhanced EPA arrangements</li>
              <li>Exact actuarial reduction factors (figures used are indicative only)</li>
              <li>Future changes to State Pension Age or scheme rules</li>
              <li>Individual circumstances that may affect your entitlement</li>
            </ul>

            <p style={{margin:"0 0 10px"}}>
              <strong>For an official estimate:</strong> use the Retirement Modeller on the Civil Service Pension Portal at <strong>www.civilservicepensionscheme.org.uk</strong>, or contact the Scheme Administrator directly.
            </p>

            <p style={{margin:"0 0 10px"}}>
              <strong>For regulated financial advice:</strong> consult an Independent Financial Adviser (IFA) authorised by the Financial Conduct Authority (FCA). You can find one at <strong>www.moneyhelper.org.uk</strong> or <strong>www.unbiased.co.uk</strong>.
            </p>

            <p style={{margin:0,color:G.textSec,fontSize:13,borderTop:`1px solid ${G.border}`,paddingTop:10,marginTop:10}}>
              By using this tool you confirmed on entry that you have read and agreed to the full disclaimer and terms of use, and that you will not treat any output as professional advice of any kind. The operator of this tool accepts no liability for any loss or damage arising from reliance on these estimates.
            </p>
          </div>

          <button onClick={()=>{setStep(0);setResults(null);setFinalSalary("");setPeriods([makePeriod("service")]);}} style={addBtnStyle}>
            Start a new calculation
          </button>
        </>}

        {/* NAV */}
        {step<4&&(
          <div style={{display:"flex",gap:16,marginTop:36,alignItems:"center"}}>
            <button onClick={next} style={primaryBtnStyle}>
              {step===3?"Calculate my pension":"Continue"}
            </button>
            {step>0&&<button onClick={back} style={backLinkStyle}>Back</button>}
          </div>
        )}
      </div>

      <div style={{background:G.greenDark,color:"rgba(255,255,255,0.7)",padding:"20px 30px",fontSize:13}}>
        <div style={{maxWidth:960,margin:"0 auto",lineHeight:1.7}}>
          <strong style={{color:"rgba(255,255,255,0.9)"}}>Civil Service Pension Estimator</strong> · Independent informal tool · Not an official Civil Service Pensions service · Not affiliated with HM Government, the Cabinet Office or Capita · Output is not financial, pension or legal advice · For official calculations visit <strong style={{color:"rgba(255,255,255,0.9)"}}>www.civilservicepensionscheme.org.uk</strong>
        </div>
      </div>
    </div>
  );
}

// ─── PERIOD CARDS ─────────────────────────────────────────────────────────────

function ServicePeriodCard({p,i,dob,errors,updatePeriod,removePeriod,canRemove,getYears}){
  const yrs=getYears(p);
  return(
    <div style={{border:`2px solid ${G.greenBorder}`,marginBottom:20,background:G.white}}>
      <div style={{background:G.greenLight,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${G.greenBorder}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:12,background:G.green,color:"white",padding:"2px 8px",fontWeight:"bold"}}>EMPLOYMENT</span>
          <strong style={{fontSize:16}}>Period {i+1} — {SCHEME_INFO[p.scheme]?.label||p.scheme}</strong>
        </div>
        {canRemove&&<button onClick={()=>removePeriod(p.id)} style={removeBtnStyle}>Remove</button>}
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
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <GovField label="Start year" id={`sy_${i}`} error={errors[`sy_${i}`]} required>
            <GovInput id={`sy_${i}`} type="number" min="1972" max={CY} value={p.startYear}
              onChange={e=>updatePeriod(p.id,"startYear",e.target.value)} width={110} placeholder="e.g. 2015" error={!!errors[`sy_${i}`]}/>
          </GovField>
          <GovField label="End year" id={`ey_${i}`}>
            <GovSelect value={p.endYear} onChange={e=>updatePeriod(p.id,"endYear",e.target.value)} width={180}>
              <option value="present">Present (still employed)</option>
              {Array.from({length:CY-1972+1},(_,k)=>CY-k).map(y=>
                <option key={y} value={y}>{y}</option>
              )}
            </GovSelect>
          </GovField>
        </div>
        {errors[`yr_${i}`]&&<ErrorMsg>{errors[`yr_${i}`]}</ErrorMsg>}
        {p.scheme==="classicplus"&&(
          <GovField label="Years of Classic service (before 1 October 2002)" id={`cy_${i}`}
            hint="Number of years accrued under Classic rules" error={errors[`cy_${i}`]} required>
            <GovInput id={`cy_${i}`} type="number" min="0" max={yrs} value={p.classicYears}
              onChange={e=>updatePeriod(p.id,"classicYears",e.target.value)} width={80} error={!!errors[`cy_${i}`]}/>
          </GovField>
        )}
        {yrs>0&&(
          <div style={{background:G.greenLight,border:`1px solid ${G.greenBorder}`,padding:"8px 12px",fontSize:14,marginTop:4,color:G.greenDark}}>
            <strong>{yrs}</strong> year{yrs!==1?"s":""} of service · NPA: <strong>{getNPA(p.scheme,dob)}</strong>
            {["nuvos","alpha"].includes(p.scheme)&&<span style={{color:G.textSec}}> · Year-by-year salaries needed on next step</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function BreakCard({p,i,errors,updatePeriod,removePeriod}){
  const bs=parseInt(p.breakStart)||0;
  const be=parseInt(p.breakEnd)||0;
  const yrs=bs&&be?Math.max(0,be-bs):0;
  return(
    <div style={{border:`2px solid ${G.warning}`,marginBottom:20,background:G.white}}>
      <div style={{background:"#fff0e0",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${G.warning}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:12,background:G.warning,color:"white",padding:"2px 8px",fontWeight:"bold"}}>BREAK</span>
          <strong style={{fontSize:16}}>Break in service</strong>
        </div>
        <button onClick={()=>removePeriod(p.id)} style={removeBtnStyle}>Remove</button>
      </div>
      <div style={{padding:20}}>
        <GovHint>Record the years you were not employed in the Civil Service. A break of 5 or more years means the final salary link for Classic/Premium benefits built up before the break is lost.</GovHint>
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <GovField label="Break start year" id={`bs_${i}`} error={errors[`bs_${i}`]} required>
            <GovInput id={`bs_${i}`} type="number" min="1972" max={CY} value={p.breakStart}
              onChange={e=>updatePeriod(p.id,"breakStart",e.target.value)} width={110} placeholder="e.g. 2010" error={!!errors[`bs_${i}`]}/>
          </GovField>
          <GovField label="Break end year (rejoined CS)" id={`be_${i}`} error={errors[`be_${i}`]} required>
            <GovInput id={`be_${i}`} type="number" min="1972" max={CY} value={p.breakEnd}
              onChange={e=>updatePeriod(p.id,"breakEnd",e.target.value)} width={110} placeholder="e.g. 2015" error={!!errors[`be_${i}`]}/>
          </GovField>
        </div>
        {yrs>0&&(
          <div style={{
            background: yrs>=5?"#fde8e0":"#e8f5e9",
            border:`1px solid ${yrs>=5?G.error:G.green}`,
            padding:"8px 12px",fontSize:14,marginTop:4,
            color:yrs>=5?G.error:G.greenDark, fontWeight:"bold",
          }}>
            {yrs} year{yrs!==1?"s":""} break
            {yrs>=5?" — final salary link to pre-break Classic/Premium benefits is LOST":" — final salary link retained (break under 5 years)"}
          </div>
        )}
      </div>
    </div>
  );
}

function TransferCard({p,i,errors,updatePeriod,removePeriod}){
  return(
    <div style={{border:`2px solid ${G.link}`,marginBottom:20,background:G.white}}>
      <div style={{background:"#dce9f7",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${G.link}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:12,background:G.link,color:"white",padding:"2px 8px",fontWeight:"bold"}}>TRANSFER IN</span>
          <strong style={{fontSize:16}}>Pension transferred in</strong>
        </div>
        <button onClick={()=>removePeriod(p.id)} style={removeBtnStyle}>Remove</button>
      </div>
      <div style={{padding:20}}>
        <GovField label="Type of transfer" id={`tt_${i}`}
          hint="Check your transfer paperwork or Annual Benefit Statement to find out which type applies.">
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
            {[
              {val:"club",label:"Club transfer",desc:"From another public sector scheme (NHS, teachers, local government, etc.). Bought a service credit in nuvos linked to final salary."},
              {val:"nonclub",label:"Non-Club transfer",desc:"From a private pension or non-Club scheme. Bought a fixed annual pension amount, uprated by CPI."},
            ].map(opt=>(
              <label key={opt.val} style={{
                display:"flex",gap:12,cursor:"pointer",alignItems:"flex-start",
                background:p.transferType===opt.val?G.greenLight:"transparent",
                border:`2px solid ${p.transferType===opt.val?G.greenBorder:G.border}`,
                padding:"10px 12px",
              }}>
                <input type="radio" name={`tt_${p.id}`} value={opt.val}
                  checked={p.transferType===opt.val}
                  onChange={()=>updatePeriod(p.id,"transferType",opt.val)}
                  style={{marginTop:3,accentColor:G.green,width:18,height:18,flexShrink:0}}/>
                <div>
                  <div style={{fontSize:15,fontWeight:"bold"}}>{opt.label}</div>
                  <div style={{fontSize:13,color:G.textSec,marginTop:2}}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </GovField>

        <GovField label="Transferred into which scheme" id={`ts_${i}`}
          hint="Usually Nuvos for Club transfers into CSPS; Alpha or Nuvos for non-Club transfers.">
          <GovSelect value={p.transferScheme} onChange={e=>updatePeriod(p.id,"transferScheme",e.target.value)} width={260}>
            <option value="nuvos">Nuvos</option>
            <option value="alpha">Alpha</option>
            <option value="premium">Premium</option>
            <option value="classic">Classic</option>
          </GovSelect>
        </GovField>

        {p.transferType==="club"?(
          <GovField label="Service credit received (years)" id={`tc_${i}`} error={errors[`tc_${i}`]} required
            hint="The number of years of equivalent service the transfer bought. Shown on your transfer confirmation letter or Annual Benefit Statement.">
            <GovInput id={`tc_${i}`} type="number" min="0" max="50" value={p.serviceCredit}
              onChange={e=>updatePeriod(p.id,"serviceCredit",e.target.value)} width={120} placeholder="e.g. 8.5" error={!!errors[`tc_${i}`]}/>
          </GovField>
        ):(
          <GovField label="Annual pension bought (£ per year)" id={`tv_${i}`} error={errors[`tv_${i}`]} required
            hint="The fixed annual pension amount the transfer bought. Shown on your transfer confirmation letter. This amount is uprated by CPI each year.">
            <PoundInput id={`tv_${i}`} value={p.annualPensionValue}
              onChange={e=>updatePeriod(p.id,"annualPensionValue",e.target.value)} error={!!errors[`tv_${i}`]}/>
          </GovField>
        )}

        {p.transferType==="club"&&p.serviceCredit&&!isNaN(p.serviceCredit)&&(
          <div style={{background:G.greenLight,border:`1px solid ${G.greenBorder}`,padding:"8px 12px",fontSize:14,color:G.greenDark}}>
            At retirement this will be calculated as: {p.serviceCredit} years × 1/60 × your final salary
          </div>
        )}
        {p.transferType==="nonclub"&&p.annualPensionValue&&!isNaN(p.annualPensionValue)&&(
          <div style={{background:"#dce9f7",border:`1px solid ${G.link}`,padding:"8px 12px",fontSize:14,color:G.greenDark}}>
            Fixed annual pension of {fmt(parseFloat(p.annualPensionValue))} (uprated by CPI to retirement date)
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SHARED UI COMPONENTS ────────────────────────────────────────────────────

function H1({children}){return<h1 style={{fontSize:32,fontWeight:"bold",margin:"0 0 8px",borderBottom:`4px solid ${G.green}`,paddingBottom:12}}>{children}</h1>;}
function GovHint({children}){return<p style={{color:G.textSec,fontSize:16,margin:"4px 0 20px",lineHeight:1.6}}>{children}</p>;}
function GovField({label,id,hint,error,required,children}){
  return(
    <div style={{marginBottom:22}}>
      <label htmlFor={id} style={{display:"block",fontWeight:"bold",fontSize:17,marginBottom:4}}>
        {label}{required&&<span style={{color:G.error}}> *</span>}
      </label>
      {hint&&<div style={{color:G.textSec,fontSize:14,marginBottom:6}}>{hint}</div>}
      {error&&<ErrorMsg>{error}</ErrorMsg>}
      {children}
    </div>
  );
}
function GovInput({id,type="text",value,onChange,width,placeholder,error}){
  return(
    <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{border:`2px solid ${error?G.error:G.borderDark}`,padding:"8px 12px",fontSize:17,
        width:width||"100%",fontFamily:G.font,outline:"none",boxSizing:"border-box"}}/>
  );
}
function GovSelect({value,onChange,children,width}){
  return(
    <select value={value} onChange={onChange}
      style={{border:`2px solid ${G.borderDark}`,padding:"8px 12px",fontSize:16,
        fontFamily:G.font,background:G.white,color:G.text,width:width||"100%",outline:"none",cursor:"pointer"}}>
      {children}
    </select>
  );
}
function PoundInput({id,value,onChange,error}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:20,fontWeight:"bold"}}>£</span>
      <GovInput id={id} type="number" value={value} onChange={onChange} width={200} placeholder="e.g. 42000" error={error}/>
    </div>
  );
}
function GovRadio({name,value,checked,onChange,label,hint}){
  return(
    <label style={{display:"flex",gap:12,marginBottom:10,cursor:"pointer",alignItems:"flex-start",
      background:checked?G.greenLight:G.white,border:`2px solid ${checked?G.greenBorder:G.border}`,padding:"12px 14px"}}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange}
        style={{marginTop:3,accentColor:G.green,width:20,height:20,flexShrink:0}}/>
      <div>
        <div style={{fontSize:16,fontWeight:"bold"}}>{label}</div>
        {hint&&<div style={{fontSize:14,color:G.textSec,marginTop:3,lineHeight:1.5}}>{hint}</div>}
      </div>
    </label>
  );
}
function GovCheckbox({id,checked,onChange,label}){
  return(
    <label htmlFor={id} style={{display:"flex",gap:12,cursor:"pointer",alignItems:"center",marginBottom:12}}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange}
        style={{accentColor:G.green,width:24,height:24,flexShrink:0}}/>
      <span style={{fontSize:17}}>{label}</span>
    </label>
  );
}
function GovInset({children}){
  return(
    <div style={{borderLeft:`6px solid ${G.green}`,paddingLeft:16,margin:"12px 0 20px",fontSize:15,lineHeight:1.6}}>
      {children}
    </div>
  );
}
function GovDetails({summary,children}){
  return(
    <details style={{marginBottom:20,border:`1px solid ${G.border}`}}>
      <summary style={{padding:"10px 14px",cursor:"pointer",fontWeight:"bold",fontSize:15,color:G.link,background:G.bg,listStyle:"none"}}>
        ▶ {summary}
      </summary>
      <div style={{padding:"14px 16px",fontSize:14,lineHeight:1.7,background:G.white}}>
        {children}
      </div>
    </details>
  );
}
function ErrorMsg({children}){
  return<div style={{color:G.error,fontWeight:"bold",fontSize:15,padding:"3px 0 6px"}}>⚠ {children}</div>;
}
function Divider(){return<hr style={{border:"none",borderTop:`1px solid ${G.border}`,margin:"28px 0"}}/>;}
function SchemeTable({rows}){
  return(
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
      <thead>
        <tr style={{background:G.greenDark,color:G.white}}>
          {["When you joined","Scheme","How it works"].map(h=>(
            <th key={h} style={{padding:"8px 12px",textAlign:"left"}}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r,i)=>(
          <tr key={i} style={{background:i%2===0?G.white:G.bg,borderBottom:`1px solid ${G.border}`}}>
            {r.map((c,j)=><td key={j} style={{padding:"8px 12px",fontSize:13}}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle={padding:"10px 14px",textAlign:"left",fontWeight:"bold",fontSize:14,color:G.greenDark};
const sectionH2={fontSize:22,fontWeight:"bold",borderBottom:`2px solid ${G.green}`,paddingBottom:8,margin:"0 0 14px"};
const primaryBtnStyle={background:G.green,color:G.white,border:"2px solid transparent",padding:"12px 24px",fontSize:18,fontWeight:"bold",fontFamily:G.font,cursor:"pointer",letterSpacing:0.2};
const backLinkStyle={background:"transparent",border:"none",color:G.link,fontSize:16,fontFamily:G.font,cursor:"pointer",textDecoration:"underline",padding:0};
const removeBtnStyle={background:"transparent",border:`1px solid ${G.error}`,color:G.error,padding:"4px 12px",fontSize:13,fontFamily:G.font,cursor:"pointer"};
const addBtnStyle={background:G.green,border:`2px solid ${G.green}`,color:"white",padding:"10px 20px",fontSize:15,fontWeight:"bold",fontFamily:G.font,cursor:"pointer",display:"inline-block",marginTop:4};
const addBtnStyleOutline={background:"transparent",border:`2px solid ${G.green}`,color:G.green,padding:"10px 20px",fontSize:15,fontWeight:"bold",fontFamily:G.font,cursor:"pointer",display:"inline-block",marginTop:4};
