// Restricted JSON Schema compatible with Responses API Structured Outputs.
const s = { type: 'string' };
const strings = { type: 'array', items: s };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (item) => ({ type: 'array', items: item });
const en = (...values) => ({ type: 'string', enum: values });

export const analysisSchema = obj({
  projectName: s,
  executiveSummary: s,
  businessProblem: s,
  businessGoals: strings,
  stakeholders: arr(obj({ role: s, need: s })),
  scopeIn: strings,
  scopeOut: strings,
  businessRules: arr(obj({ rule: s, sourceEvidence: s, certainty: en('confirmed', 'assumption') })),
  functionalRequirements: arr(obj({
    name: s, description: s, actor: s, priority: en('Must','Should','Could'),
    sourceEvidence: s, certainty: en('confirmed','assumption'),
    relatedBusinessGoal: s, preconditions: strings, mainFlow: strings,
    alternateFlows: strings, acceptanceCriteria: strings
  })),
  nonFunctionalRequirements: arr(obj({
    category: s, description: s, measurableTarget: s,
    certainty: en('confirmed','assumption'), sourceEvidence: s
  })),
  clarificationQuestions: arr(obj({ question: s, impact: s, priority: en('High','Medium','Low') })),
  assumptions: strings,
  risks: strings
});

export const prototypeSchema = obj({
  screens: arr(obj({
    id: s, title: s, description: s, requirementIds: strings,
    components: arr(obj({
      type: en('heading','paragraph','input','textarea','select','button','card','list','badge'),
      label: s, placeholder: s, value: s, options: strings, actionTarget: s
    }))
  }))
});

// v3.7: proposals are draft choices, not automatically validated business facts.
export const clarificationRecommendationSchema = obj({
 questions: arr(obj({
  questionId:s,preferredIndex:{type:'integer'},
  options:arr(obj({title:s,answer:s,benefits:s,tradeoffs:s,implementation:s,stackReferences:strings,feasibility:en('compatible','requires-change','unknown')}))
 }))
});
