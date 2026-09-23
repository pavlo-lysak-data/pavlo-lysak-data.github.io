
const COURSE = window.COURSE;
const STORAGE_KEY = "linux-network-security-course-v2";
const TUTOR_STORAGE_KEY = "linux-network-security-tutor-v1";
const TUTOR_PROVIDER_KEY = "linux-network-security-tutor-provider-v1";
const TUTOR_PROVIDERS = {
  gemini:{
    label:"Gemini 3.6 Flash",
    eyebrow:"Gemini 3.6 Flash • Default tutor",
    unavailable:"The Gemini tutor is unavailable. Please try again."
  },
  openai:{
    label:"GPT-5.6 Sol",
    eyebrow:"GPT-5.6 Sol • Alternate tutor",
    unavailable:"The GPT-5.6 tutor is unavailable. Please try again."
  }
};
const PASS_MARK = 70;
const TUTOR_STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","can","do","does","for","from","how","i",
  "in","is","it","me","my","of","on","or","the","this","to","what","when","where",
  "which","why","with","you"
]);

const state = loadState();
const tutorStore = loadTutorStore();
let currentModuleId = state.currentModuleId || COURSE.modules[0].id;
let currentTab = "theory";
let tutorReturnFocus = null;
let tutorBusy = false;
let tutorProvider = loadTutorProvider();

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];

function defaultModuleState(){
  return {theoryRead:false,quizScore:null,quizPassed:false,labPassed:false,labDone:[]};
}
function loadState(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
    if(!parsed||typeof parsed!=="object")return {};
    if(parsed.contentVersion!==COURSE.version){
      Object.values(parsed.modules||{}).forEach(moduleState=>{moduleState.theoryRead=false});
      parsed.contentVersion=COURSE.version;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(parsed));
    }
    return parsed;
  }catch{return {}}
}
function ensureModuleState(id){
  state.modules ||= {};
  state.modules[id] ||= defaultModuleState();
  return state.modules[id];
}
function saveState(){
  state.currentModuleId=currentModuleId;
  state.contentVersion=COURSE.version;
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  updateProgress();
  renderNav();
}
function getModule(id=currentModuleId){
  return COURSE.modules.find(m=>m.id===id)||COURSE.modules[0];
}
function loadTutorStore(){
  try{
    const parsed=JSON.parse(localStorage.getItem(TUTOR_STORAGE_KEY)||"{}");
    return parsed&&typeof parsed==="object"?parsed:{};
  }catch{return {}}
}
function saveTutorStore(){
  localStorage.setItem(TUTOR_STORAGE_KEY,JSON.stringify(tutorStore));
}
function loadTutorProvider(){
  try{
    const saved=localStorage.getItem(TUTOR_PROVIDER_KEY);
    return saved&&TUTOR_PROVIDERS[saved]?saved:"gemini";
  }catch{return "gemini"}
}
function updateTutorProviderControls(){
  const provider=TUTOR_PROVIDERS[tutorProvider];
  $("#tutorProviderLabel").textContent=provider.eyebrow;
  $("#tutorDisclaimer").textContent=`Powered by ${provider.label} and grounded in this course’s lessons. Run commands only in systems you are authorized to administer.`;
  $$("[data-tutor-provider]").forEach(button=>{
    const selected=button.dataset.tutorProvider===tutorProvider;
    button.classList.toggle("is-active",selected);
    button.setAttribute("aria-pressed",String(selected));
    button.disabled=tutorBusy;
  });
}
function setTutorProvider(provider){
  if(tutorBusy||!TUTOR_PROVIDERS[provider]||provider===tutorProvider)return;
  tutorProvider=provider;
  localStorage.setItem(TUTOR_PROVIDER_KEY,tutorProvider);
  updateTutorProviderControls();
  showToast(`${TUTOR_PROVIDERS[tutorProvider].label} selected`);
  $("#tutorInput").focus();
}
function tutorGreeting(courseModule){
  return `You’re studying ${courseModule.title}.\n\nAsk me to explain a concept, connect it to a production use case, give a quiz hint, or guide you through a lab task. My answers stay grounded in this module’s course material.`;
}
function tutorHistory(courseModule){
  tutorStore[courseModule.id] ||= [{role:"assistant",text:tutorGreeting(courseModule)}];
  return tutorStore[courseModule.id];
}
function tutorTokens(text){
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9+/.-]+/g," ")
    .split(/\s+/)
    .filter(token=>token.length>1&&!TUTOR_STOP_WORDS.has(token));
}
function tutorKnowledge(courseModule){
  const entries=[];
  courseModule.theory.forEach(item=>entries.push({
    kind:"Core concept",title:item.heading,body:item.text
  }));
  (courseModule.technicalDetails||[]).forEach(item=>entries.push({
    kind:"Technical detail",title:item.heading,
    body:`${item.text}\n\nOperational use: ${item.useCase}`
  }));
  (courseModule.useCases||[]).forEach(item=>entries.push({
    kind:"Production use case",title:item.title,
    body:`Situation: ${item.scenario}\nApply it: ${item.application}`
  }));
  courseModule.quiz.forEach((item,index)=>entries.push({
    kind:`Quiz Q${index+1}`,title:item.prompt,
    body:`Correct answer: ${item.options[item.answer]}\nReasoning: ${item.explanation}`,
    quizIndex:index,options:item.options
  }));
  entries.push({
    kind:"Lab overview",title:courseModule.lab.title,
    body:`Scenario: ${courseModule.lab.scenario}\nEnvironment: ${courseModule.lab.environment.join(", ")}\nSafety: ${courseModule.lab.safety}`
  });
  courseModule.lab.tasks.forEach((task,index)=>entries.push({
    kind:`Lab task ${index+1}`,title:task.title,
    body:`Goal: ${task.goal}\nGuidance: ${task.hint}\nExpected evidence:\n${task.output}\nWhy it matters: ${(courseModule.labContexts||[])[index]||task.goal}`,
    labIndex:index
  }));
  return entries;
}
function scoreTutorEntry(entry,queryTokens,rawQuery){
  const titleTokens=tutorTokens(entry.title);
  const bodyTokens=tutorTokens(entry.body);
  const haystack=new Set([...titleTokens,...bodyTokens]);
  let score=queryTokens.reduce((total,token)=>total+(haystack.has(token)?1:0),0);
  score+=queryTokens.reduce((total,token)=>total+(titleTokens.includes(token)?1.5:0),0);
  if(rawQuery.toLowerCase().includes(entry.title.toLowerCase()))score+=4;
  return score;
}
function quizTutorAnswer(courseModule,message){
  const match=message.match(/\b(?:quiz\s*)?(?:question|q)\s*#?\s*(10|[1-9])\b/i);
  if(!match)return null;
  const index=Number(match[1])-1;
  const item=courseModule.quiz[index];
  if(!item)return null;
  const reveal=/\b(answer|correct|reveal|solution|show)\b/i.test(message);
  if(reveal){
    return `Quiz Q${index+1}: ${item.prompt}\n\nCorrect answer: ${item.options[item.answer]}\n\nWhy: ${item.explanation}`;
  }
  return `Hint for Quiz Q${index+1}: ${item.prompt}\n\nFocus on this reasoning: ${item.explanation}\n\nChoose the option that best matches that principle. If you want the option revealed, ask “show the answer to question ${index+1}.”`;
}
function labTutorAnswer(courseModule,message){
  const match=message.match(/\b(?:lab\s*)?(?:task|step)\s*#?\s*([1-6])\b/i);
  if(!match)return null;
  const index=Number(match[1])-1;
  const task=courseModule.lab.tasks[index];
  if(!task)return null;
  const context=(courseModule.labContexts||[])[index]||task.goal;
  return `Lab task ${index+1} — ${task.title}\n\nGoal: ${task.goal}\nCommand guidance: ${task.hint}\nWhy it matters: ${context}\n\nExpected evidence:\n${task.output}`;
}
function overviewTutorAnswer(courseModule){
  return `${courseModule.title} — module overview\n\nCore ideas: ${courseModule.theory.map(item=>item.heading).join(", ")}.\n\nYou should be able to:\n${courseModule.objectives.map((item,index)=>`${index+1}. ${item}`).join("\n")}\n\nProduction focus: ${(courseModule.useCases||[]).map(item=>item.title).join("; ")}.`;
}
function generateTutorReply(courseModule,message){
  const trimmed=message.trim();
  if(/^(hi|hello|hey|start)\b/i.test(trimmed))return tutorGreeting(courseModule);

  const quizReply=quizTutorAnswer(courseModule,trimmed);
  if(quizReply)return quizReply;

  const labReply=labTutorAnswer(courseModule,trimmed);
  if(labReply)return labReply;

  if(/\b(overview|summary|summarize|objectives?)\b/i.test(trimmed)){
    return overviewTutorAnswer(courseModule);
  }

  if(/\b(use case|production|real world|real-world|example)\b/i.test(trimmed)){
    const useCases=courseModule.useCases||[];
    return useCases.length
      ? `Production use cases in ${courseModule.title}:\n\n${useCases.map((item,index)=>`${index+1}. ${item.title}\nSituation: ${item.scenario}\nApply it: ${item.application}`).join("\n\n")}`
      : "This module does not include a separate production case. Ask about a specific concept and I’ll connect it to the lab.";
  }

  if(/\b(lab|command|terminal|exercise)\b/i.test(trimmed)){
    return `${courseModule.lab.title}\n\n${courseModule.lab.scenario}\n\nTasks:\n${courseModule.lab.tasks.map((task,index)=>`${index+1}. ${task.title} — ${task.goal}`).join("\n")}\n\nAsk about a task number for its command guidance and expected evidence.`;
  }

  if(/\b(quiz|question|test)\b/i.test(trimmed)){
    return `This module has 10 quiz questions. Ask “help with question 3” for a reasoning hint, or “show the answer to question 3” when you want the answer and explanation revealed.`;
  }

  const queryTokens=tutorTokens(trimmed);
  const ranked=tutorKnowledge(courseModule)
    .map(entry=>({entry,score:scoreTutorEntry(entry,queryTokens,trimmed)}))
    .filter(result=>result.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,2);
  if(!ranked.length){
    return `I couldn’t match that precisely to ${courseModule.title}. Try naming a protocol, command, quiz question number, or lab task from this module. You can also ask for “module overview” or “production use cases.”`;
  }
  return ranked.map(({entry})=>`${entry.kind} — ${entry.title}\n${entry.body}`).join("\n\nRelated course material:\n");
}
function renderTutorMessages({thinking=false}={}){
  const courseModule=getModule();
  const messages=tutorHistory(courseModule);
  $("#tutorMessages").innerHTML=messages.map(message=>`
    <div class="tutor-message ${message.role==="user"?"is-user":""}">
      ${message.role==="assistant"?'<span class="tutor-message__avatar" aria-hidden="true">✦</span>':""}
      <div class="tutor-message__bubble">${escapeHtml(message.text)}</div>
    </div>`).join("")+(
      thinking?`<div class="tutor-message is-thinking"><span class="tutor-message__avatar" aria-hidden="true">✦</span><div class="tutor-message__bubble">${escapeHtml(TUTOR_PROVIDERS[tutorProvider].label)} is finding the most relevant course material…</div></div>`:""
    );
  $("#tutorMessages").scrollTop=$("#tutorMessages").scrollHeight;
}
function updateTutorContext(courseModule){
  $("#tutorModuleLabel").textContent=courseModule.title;
  const suggestions=[
    "Give me a module overview",
    "Help with question 1",
    "Guide me through lab task 1",
    "Show production use cases"
  ];
  $("#tutorSuggestions").innerHTML=suggestions.map(text=>`<button class="tutor-suggestion" type="button">${escapeHtml(text)}</button>`).join("");
  $$(".tutor-suggestion").forEach(button=>button.addEventListener("click",()=>sendTutorMessage(button.textContent)));
  if($("#tutorPanel").classList.contains("is-open"))renderTutorMessages();
}
function openTutor(event){
  tutorReturnFocus=event?.currentTarget||document.activeElement;
  $("#sidebar").classList.remove("open");
  $("#tutorPanel").setAttribute("aria-hidden","false");
  document.body.classList.add("tutor-open");
  updateTutorContext(getModule());
  updateTutorProviderControls();
  renderTutorMessages();
  requestAnimationFrame(()=>{
    $("#tutorPanel").classList.add("is-open");
    $("#tutorInput").focus();
  });
}
function closeTutor(){
  $("#tutorPanel").classList.remove("is-open");
  $("#tutorPanel").setAttribute("aria-hidden","true");
  document.body.classList.remove("tutor-open");
  setTimeout(()=>tutorReturnFocus?.focus(),230);
}
async function sendTutorMessage(text){
  const message=String(text||"").trim();
  if(!message||tutorBusy)return;
  const courseModule=getModule();
  const provider=tutorProvider;
  const history=tutorHistory(courseModule);
  history.push({role:"user",text:message});
  tutorStore[courseModule.id]=history.slice(-30);
  saveTutorStore();
  tutorBusy=true;
  updateTutorProviderControls();
  renderTutorMessages({thinking:true});
  $("#tutorInput").value="";
  try{
    const response=await fetch("https://networking-security-lab.yagami-tsuki.chatgpt.site/api/tutor",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        message,
        provider,
        module:{
          id:courseModule.id,
          title:courseModule.title,
          context:courseModule
        },
        history:history.slice(0,-1).slice(-12)
      })
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||TUTOR_PROVIDERS[provider].unavailable);
    const activeHistory=tutorHistory(courseModule);
    activeHistory.push({role:"assistant",text:payload.reply});
    tutorStore[courseModule.id]=activeHistory.slice(-30);
    saveTutorStore();
  }catch(error){
    const activeHistory=tutorHistory(courseModule);
    activeHistory.push({
      role:"assistant",
      text:error instanceof Error
        ? error.message
        : TUTOR_PROVIDERS[provider].unavailable
    });
    tutorStore[courseModule.id]=activeHistory.slice(-30);
    saveTutorStore();
  }finally{
    tutorBusy=false;
    updateTutorProviderControls();
    if(courseModule.id===currentModuleId)renderTutorMessages();
  }
}
function moduleComplete(id){
  const s=ensureModuleState(id);
  return s.theoryRead&&s.quizPassed&&s.labPassed;
}
function showToast(message){
  const toast=$("#toast");
  toast.textContent=message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>toast.classList.remove("show"),2400);
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
}
function escapeAttr(value){return escapeHtml(value)}

function renderNav(){
  const nav=$("#moduleNav");
  nav.innerHTML=COURSE.modules.map(m=>{
    const s=ensureModuleState(m.id);
    const done=moduleComplete(m.id);
    const pieces=[s.theoryRead,s.quizPassed,s.labPassed].filter(Boolean).length;
    return `<button class="module-btn ${m.id===currentModuleId?"is-active":""}" data-module="${m.id}">
      <span class="module-btn__top"><i class="status-dot ${done?"done":""}"></i>${escapeHtml(m.title)}</span>
      <span class="module-btn__meta"><span>${escapeHtml(m.badge)}</span><span>${pieces}/3</span></span>
    </button>`;
  }).join("");
  $$(".module-btn",nav).forEach(btn=>btn.addEventListener("click",()=>{
    currentModuleId=btn.dataset.module;
    currentTab="theory";
    renderCourse();
    saveState();
    if(window.innerWidth<=1000)$("#sidebar").classList.remove("open");
    window.scrollTo({top:$("#courseView").offsetTop-20,behavior:"smooth"});
  }));
}
function updateProgress(){
  let earned=0;
  const total=COURSE.modules.length*3;
  COURSE.modules.forEach(m=>{
    const s=ensureModuleState(m.id);
    earned+=Number(s.theoryRead)+Number(s.quizPassed)+Number(s.labPassed);
  });
  const pct=Math.round(earned/total*100);
  $("#progressText").textContent=`${pct}%`;
  $("#progressFill").style.width=`${pct}%`;
}
function renderCourse(){
  const courseModule=getModule();
  const ms=ensureModuleState(courseModule.id);
  updateTutorContext(courseModule);
  $("#moduleBadge").textContent=courseModule.badge;
  $("#moduleTitle").textContent=courseModule.title;
  $("#moduleMeta").textContent=`${courseModule.estimated} • Assessment-aligned theory + 10 questions + 6-task guided lab`;
  renderTheory(courseModule,ms);
  renderQuiz(courseModule,ms);
  renderLab(courseModule,ms);
  renderResources(courseModule);
  selectTab(currentTab);
  renderNav();
  updateProgress();
}
function renderTheory(module,ms){
  const panel=$("#panel-theory");
  const technicalDetails=module.technicalDetails||[];
  const useCases=module.useCases||[];
  const labContexts=module.labContexts||[];
  panel.innerHTML=`
    <section class="card theory-roadmap">
      <div>
        <span class="section-kicker">Assessment-aligned lesson</span>
        <h4>Everything you need for this module’s quiz and lab</h4>
        <p>This lesson teaches the concepts first, connects them to production use cases, explains all ${module.quiz.length} quiz rationales, and prepares every lab command before you enter the simulator.</p>
      </div>
      <div class="coverage-strip" aria-label="Theory coverage">
        <span><strong>${module.theory.length}</strong> core concepts</span>
        <span><strong>${technicalDetails.length}</strong> technical deep dives</span>
        <span><strong>${useCases.length}</strong> operational use cases</span>
        <span><strong>${module.quiz.length}</strong> quiz rationales</span>
        <span><strong>${module.lab.tasks.length}</strong> lab briefings</span>
      </div>
      <div class="learning-objectives">
        <h5>After this lesson, you can:</h5>
        <ol>${module.objectives.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ol>
      </div>
    </section>

    <nav class="theory-jump-nav" aria-label="Theory sections">
      <a href="#core-concepts">Core concepts</a>
      <a href="#technical-mechanics">Technical mechanics</a>
      <a href="#operational-use-cases">Use cases</a>
      <a href="#quiz-knowledge-map">Quiz knowledge map</a>
      <a href="#lab-preparation">Lab preparation</a>
    </nav>

    <section class="theory-section" id="core-concepts">
      <div class="section-heading">
        <div>
          <span class="section-kicker">01 • Foundation</span>
          <h4>Core concepts</h4>
        </div>
        <p>The concise mental model to retain.</p>
      </div>
    <div class="theory-grid">
      ${module.theory.map((item,i)=>`
        <article class="card theory-card">
          <div class="theory-card__number">${i+1}</div>
          <h4>${escapeHtml(item.heading)}</h4>
          <p>${escapeHtml(item.text)}</p>
        </article>`).join("")}
    </div>
    </section>

    <section class="theory-section" id="technical-mechanics">
      <div class="section-heading">
        <div>
          <span class="section-kicker">02 • How it works</span>
          <h4>Technical mechanics</h4>
        </div>
        <p>Details that explain the commands, packets, states, and policy decisions.</p>
      </div>
      <div class="technical-grid">
        ${technicalDetails.map((item,i)=>`
          <article class="card technical-card">
            <div class="technical-card__top">
              <span class="technical-index">${String(i+1).padStart(2,"0")}</span>
              <h5>${escapeHtml(item.heading)}</h5>
            </div>
            <p>${escapeHtml(item.text)}</p>
            <div class="application-callout"><strong>When to use it</strong>${escapeHtml(item.useCase)}</div>
          </article>`).join("")}
      </div>
    </section>

    <section class="theory-section" id="operational-use-cases">
      <div class="section-heading">
        <div>
          <span class="section-kicker">03 • Production context</span>
          <h4>Operational use cases</h4>
        </div>
        <p>How the concepts guide real engineering decisions.</p>
      </div>
      <div class="use-case-grid">
        ${useCases.map((item,i)=>`
          <article class="card use-case-card">
            <span class="use-case-label">Use case ${i+1}</span>
            <h5>${escapeHtml(item.title)}</h5>
            <p><strong>Situation:</strong> ${escapeHtml(item.scenario)}</p>
            <p><strong>Apply:</strong> ${escapeHtml(item.application)}</p>
          </article>`).join("")}
      </div>
    </section>

    <section class="theory-section" id="quiz-knowledge-map">
      <div class="section-heading">
        <div>
          <span class="section-kicker">04 • Quiz preparation</span>
          <h4>Quiz knowledge map</h4>
        </div>
        <p>Every assessed concept and its reasoning. Study the explanation, not only the answer.</p>
      </div>
      <div class="study-toolbar">
        <button class="ghost-btn" type="button" id="expandTheory">Expand all study notes</button>
        <button class="ghost-btn" type="button" id="collapseTheory">Collapse all</button>
      </div>
      <div class="knowledge-list">
        ${module.quiz.map((item,i)=>`
          <details class="card study-note knowledge-item">
            <summary>
              <span class="knowledge-index">Q${i+1}</span>
              <span>${escapeHtml(item.prompt)}</span>
            </summary>
            <div class="study-note__body">
              <div class="answer-key"><span>Key answer</span><strong>${escapeHtml(item.options[item.answer])}</strong></div>
              <p>${escapeHtml(item.explanation)}</p>
            </div>
          </details>`).join("")}
      </div>
    </section>

    <section class="theory-section" id="lab-preparation">
      <div class="section-heading">
        <div>
          <span class="section-kicker">05 • Before the simulator</span>
          <h4>Lab preparation and command reasoning</h4>
        </div>
        <p>What each task changes or observes, why it matters, and what evidence to expect.</p>
      </div>
      <div class="lab-prep-list">
        ${module.lab.tasks.map((task,i)=>`
          <details class="card study-note lab-prep-item">
            <summary>
              <span class="knowledge-index">Task ${i+1}</span>
              <span>${escapeHtml(task.title)} — ${escapeHtml(task.goal)}</span>
            </summary>
            <div class="study-note__body">
              <div class="lab-reason">
                <strong>Why engineers use it</strong>
                <p>${escapeHtml(labContexts[i]||task.goal)}</p>
              </div>
              <div class="command-model">
                <span>Command model</span>
                <code>${escapeHtml(task.hint)}</code>
              </div>
              <details class="expected-output">
                <summary>Show expected evidence</summary>
                <pre>${escapeHtml(task.output)}</pre>
              </details>
            </div>
          </details>`).join("")}
      </div>
    </section>

    <div class="panel-actions">
      <button class="primary-btn" id="markTheory">${ms.theoryRead?"✓ Theory marked complete":"Mark theory complete"}</button>
      <button class="ghost-btn" data-go-tab="quiz">Continue to quiz →</button>
    </div>`;
  $("#expandTheory").addEventListener("click",()=>{
    $$("details.study-note",panel).forEach(item=>{item.open=true});
  });
  $("#collapseTheory").addEventListener("click",()=>{
    $$("details.study-note",panel).forEach(item=>{item.open=false});
  });
  $("#markTheory").addEventListener("click",()=>{
    ms.theoryRead=true;
    saveState();
    renderTheory(module,ms);
    showToast("Theory marked complete.");
  });
  bindGoTabs(panel);
}
function renderQuiz(module,ms){
  const panel=$("#panel-quiz");
  panel.innerHTML=`
    <div class="score-box ${ms.quizScore!==null?"show":""}" id="scoreBox">
      ${ms.quizScore!==null?scoreMessage(ms.quizScore):""}
    </div>
    <form id="quizForm">
      ${module.quiz.map((item,qi)=>`
        <article class="card question" data-question="${qi}">
          <div class="question__head">
            <div class="question__number">${qi+1}</div>
            <div style="flex:1">
              <h4>${escapeHtml(item.prompt)}</h4>
              <div class="options">
                ${item.options.map((opt,oi)=>`
                  <label class="option">
                    <input type="radio" name="q${qi}" value="${oi}">
                    <span>${escapeHtml(opt)}</span>
                  </label>`).join("")}
              </div>
              <div class="explanation"><strong>Answer:</strong> ${escapeHtml(item.options[item.answer])}<br>${escapeHtml(item.explanation)}</div>
            </div>
          </div>
        </article>`).join("")}
      <div class="panel-actions">
        <button class="primary-btn" type="submit">Submit quiz</button>
        <button class="ghost-btn" type="button" id="resetQuiz">Clear answers</button>
        <button class="ghost-btn" type="button" data-go-tab="lab">Continue to lab →</button>
      </div>
    </form>`;
  $("#quizForm").addEventListener("submit",event=>{
    event.preventDefault();
    let correct=0,answered=0;
    module.quiz.forEach((item,qi)=>{
      const card=$(`.question[data-question="${qi}"]`,panel);
      const selected=$(`input[name="q${qi}"]:checked`,panel);
      $$(".option",card).forEach((label,oi)=>{
        label.classList.toggle("correct",oi===item.answer);
        label.classList.toggle("wrong",Boolean(selected)&&Number(selected.value)===oi&&oi!==item.answer);
      });
      card.classList.add("reviewed");
      if(selected){
        answered++;
        if(Number(selected.value)===item.answer)correct++;
      }
    });
    if(answered<module.quiz.length)showToast(`Answered ${answered} of ${module.quiz.length}; unanswered questions count as incorrect.`);
    const score=Math.round(correct/module.quiz.length*100);
    ms.quizScore=score;
    ms.quizPassed=score>=PASS_MARK;
    $("#scoreBox").classList.add("show");
    $("#scoreBox").innerHTML=scoreMessage(score);
    saveState();
    showToast(ms.quizPassed?`Quiz passed: ${score}%`:`Score: ${score}%. Review and retry.`);
    window.scrollTo({top:$("#panel-quiz").offsetTop-80,behavior:"smooth"});
  });
  $("#resetQuiz").addEventListener("click",()=>{
    $("#quizForm").reset();
    $$(".question",panel).forEach(card=>{
      card.classList.remove("reviewed");
      $$(".option",card).forEach(o=>o.classList.remove("correct","wrong"));
    });
  });
  bindGoTabs(panel);
}
function scoreMessage(score){
  const passed=score>=PASS_MARK;
  return `<strong>${passed?"Passed":"Not yet passed"} — ${score}%</strong>
    <div style="color:var(--muted);margin-top:5px">${passed?"You reached the 70% pass mark.":"Review the explanations and retry. The pass mark is 70%."}</div>`;
}
function renderLab(module,ms){
  const panel=$("#panel-lab");
  const done=new Set(ms.labDone||[]);
  panel.innerHTML=`
    <div class="lab-layout">
      <section class="card lab-brief">
        <span class="badge">${escapeHtml(module.badge)} lab</span>
        <h4 style="margin-top:14px">${escapeHtml(module.lab.title)}</h4>
        <p>${escapeHtml(module.lab.scenario)}</p>
        <strong>Environment</strong>
        <ul>${module.lab.environment.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>
        <div class="notice"><strong>Safety:</strong> ${escapeHtml(module.lab.safety)}</div>
        <div class="task-list">
          ${module.lab.tasks.map((t,i)=>`
            <div class="task-item ${done.has(i)?"done":""}" data-task="${i}">
              <div class="task-item__row">
                <span class="task-check">${done.has(i)?"✓":i+1}</span>
                <div>
                  <strong>${escapeHtml(t.title)}</strong>
                  <small>${escapeHtml(t.goal)}</small>
                  <button class="hint-btn" data-hint="${i}">Show hint</button>
                  <div class="hint" id="hint-${i}">${escapeHtml(t.hint)}</div>
                </div>
              </div>
            </div>`).join("")}
        </div>
      </section>
      <section class="terminal" aria-label="Simulated Linux terminal">
        <div class="terminal__bar">
          <div class="terminal__dots"><i></i><i></i><i></i></div>
          <span>student@ubuntu-wsl • simulated</span>
        </div>
        <div class="terminal__output" id="terminalOutput">Welcome to ${escapeHtml(module.lab.title)}.
Type a command and press Enter. Built-ins: help, clear, tasks, check.
This terminal simulates only the commands required by the current lab.
</div>
        <form class="terminal__input-row" id="terminalForm">
          <span class="prompt">student@lab:~$</span>
          <input id="terminalInput" autocomplete="off" spellcheck="false" aria-label="Terminal command">
        </form>
        <div class="terminal__actions">
          <button class="primary-btn" id="checkLab" type="button">Check lab</button>
          <button class="ghost-btn" id="resetLab" type="button">Reset lab</button>
        </div>
      </section>
    </div>`;
  $$(".hint-btn",panel).forEach(btn=>btn.addEventListener("click",()=>{
    const el=$(`#hint-${btn.dataset.hint}`,panel);
    el.classList.toggle("show");
    btn.textContent=el.classList.contains("show")?"Hide hint":"Show hint";
  }));
  $("#terminalForm").addEventListener("submit",event=>{
    event.preventDefault();
    const input=$("#terminalInput");
    const command=input.value.trim();
    if(!command)return;
    input.value="";
    runSimulatedCommand(command,module,ms,panel);
  });
  $("#checkLab").addEventListener("click",()=>checkLab(module,ms));
  $("#resetLab").addEventListener("click",()=>{
    ms.labDone=[];
    ms.labPassed=false;
    saveState();
    renderLab(module,ms);
    showToast("Lab progress reset.");
  });
}
function runSimulatedCommand(command,module,ms,panel){
  const output=$("#terminalOutput",panel);
  const append=text=>{
    output.textContent+=`\nstudent@lab:~$ ${command}\n${text}\n`;
    output.scrollTop=output.scrollHeight;
  };
  if(command==="clear"){output.textContent="";return}
  if(command==="help"){append("Built-ins: help, clear, tasks, check.\nThe simulator does not execute commands on your computer.");return}
  if(command==="tasks"){append(module.lab.tasks.map((t,i)=>`${i+1}. ${t.title}: ${t.goal}`).join("\n"));return}
  if(command==="check"){checkLab(module,ms);append("Lab validation requested.");return}

  let matched=false;
  module.lab.tasks.forEach((t,i)=>{
    let regex;
    try{regex=new RegExp(t.match,"i")}catch{return}
    if(!matched&&regex.test(command)){
      matched=true;
      const completed=new Set(ms.labDone||[]);
      completed.add(i);
      ms.labDone=[...completed].sort((a,b)=>a-b);
      append(t.output);
      saveState();
      const item=$(`.task-item[data-task="${i}"]`,panel);
      item?.classList.add("done");
      if(item)$(".task-check",item).textContent="✓";
    }
  });
  if(!matched)append("Command not recognized by this focused simulator.\nUse `tasks` or open a task hint.");
}
function checkLab(module,ms){
  const total=module.lab.tasks.length;
  const complete=new Set(ms.labDone||[]).size;
  ms.labPassed=complete===total;
  saveState();
  showToast(ms.labPassed?`Lab passed: ${complete}/${total} tasks complete.`:`Lab incomplete: ${complete}/${total} tasks complete.`);
}
function renderResources(module){
  $("#panel-resources").innerHTML=`
    <div class="resources-grid">
      ${module.resources.map(r=>`
        <a class="resource" href="${escapeAttr(r.url)}" target="_blank" rel="noopener noreferrer">
          <strong>${escapeHtml(r.label)} ↗</strong>
          <span>${escapeHtml(r.url)}</span>
        </a>`).join("")}
    </div>`;
}
function bindGoTabs(root){
  $$("[data-go-tab]",root).forEach(btn=>btn.addEventListener("click",()=>selectTab(btn.dataset.goTab)));
}
function selectTab(tab){
  currentTab=tab;
  $$(".tab-btn").forEach(btn=>{
    const selected=btn.dataset.tab===tab;
    btn.classList.toggle("is-active",selected);
    btn.setAttribute("aria-selected",String(selected));
    btn.tabIndex=selected?0:-1;
  });
  $$(".panel").forEach(panel=>{
    const selected=panel.id===`panel-${tab}`;
    panel.classList.toggle("is-active",selected);
    panel.hidden=!selected;
  });
}
function init(){
  $("#courseSubtitle").textContent=COURSE.subtitle;
  $("#sourceList").innerHTML=COURSE.sources.map(s=>`
    <li><a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a> — ${escapeHtml(s.note)}</li>`).join("");
  const tabButtons=$$(".tab-btn");
  tabButtons.forEach((btn,index)=>{
    btn.addEventListener("click",()=>selectTab(btn.dataset.tab));
    btn.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      let nextIndex=index;
      if(event.key==="ArrowRight")nextIndex=(index+1)%tabButtons.length;
      if(event.key==="ArrowLeft")nextIndex=(index-1+tabButtons.length)%tabButtons.length;
      if(event.key==="Home")nextIndex=0;
      if(event.key==="End")nextIndex=tabButtons.length-1;
      tabButtons[nextIndex].focus();
      selectTab(tabButtons[nextIndex].dataset.tab);
    });
  });
  $("#resetBtn").addEventListener("click",()=>{
    if(!confirm("Reset all course progress?"))return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
  $("#homeBtn").addEventListener("click",()=>{
    window.scrollTo({top:0,behavior:"smooth"});
    if(window.innerWidth<=1000)$("#sidebar").classList.remove("open");
  });
  $("#mobileMenu").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  $("#tutorSidebar").addEventListener("click",openTutor);
  $("#tutorLauncher").addEventListener("click",openTutor);
  $("#tutorClose").addEventListener("click",closeTutor);
  $$("[data-tutor-provider]").forEach(button=>{
    button.addEventListener("click",()=>setTutorProvider(button.dataset.tutorProvider));
  });
  $("#tutorForm").addEventListener("submit",event=>{
    event.preventDefault();
    sendTutorMessage($("#tutorInput").value);
  });
  $("#tutorInput").addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){
      event.preventDefault();
      $("#tutorForm").requestSubmit();
    }
  });
  $("#tutorClear").addEventListener("click",()=>{
    const courseModule=getModule();
    tutorStore[courseModule.id]=[{role:"assistant",text:tutorGreeting(courseModule)}];
    saveTutorStore();
    renderTutorMessages();
    $("#tutorInput").focus();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&$("#tutorPanel").classList.contains("is-open"))closeTutor();
  });
  updateTutorProviderControls();
  renderCourse();
}
init();
