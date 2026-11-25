/**
 * TutorRL judge prompts — imported VERBATIM from eth-lre/PedagogicalRL
 * (prompt_templates/judges/, CC-BY-4.0; TUTORRL_DEEPDIVE §2.2). These are
 * the CI rubrics for every prompt edit (audit Ruling 4 WAVE 3): a pedagogy
 * regression becomes a failing test, not a vibe.
 *
 * Two lanes share them:
 *   - OFFLINE (live judge model, e.g. TutorRL-7B via mlx-lm — Ruling 5 #7:
 *     offline labeling only, never a runtime router): renderJudgePrompt
 *     substitutes the conversation into the template exactly as TutorRL's
 *     classroom.py does, and parseJudgeVerdict reads the JSON verdict the
 *     way classroom.py:1000-1009 does (slice first { to last }).
 *   - CI (hermetic, no model): deterministic.ts operationalizes the two
 *     rubrics so golden transcripts are judged in vitest.
 *
 * Do not edit the template strings — byte-verbatim import is the contract
 * (professor-judges.test.ts pins it).
 */

/** prompt_templates/judges/does_not_leak_answer.txt — did the teacher
 *  withhold the answer to a check the student should have worked? */
export const DOES_NOT_LEAK_ANSWER_PROMPT =
  'You are tasked with inspecting a conversation between a student and a teacher (tutor). Your goal is to determine whether the teacher properly guided the student to the solution or whether they revealed too much information too early, such as directly giving away the final answer or solving key steps of the problem without involving the student.\n\nThe teacher should:\n- Guide the student interactively, using questions, hints, or feedback.\n- Encourage the student to reason through the problem themselves.\n- Avoid solving major parts of the problem immediately or presenting large chunks of the final solution too early.\n- Be allowed to confirm correct reasoning, correct mistakes, and clarify concepts gradually.\n- Clarify certain parts in more detail if the student does not get it.\n\nIt is **not acceptable** for the teacher to:\n- Provide the full answer upfront or within the first message.\n- Reveal all key steps in a single message without student involvement.\n- Walk through the entire solution without engaging the student meaningfully.\n\n## **Examples of correct and incorrect guidance**:\n\n### Example 1 \u2013 Good Guidance (Integration by parts):\n- Student: How do I integrate x * e^(2x)?\n- Teacher: Good question! Can you think of an integration technique useful when integrating a product of functions?\n- Student: Integration by parts?\n- Teacher: Exactly. Can you identify what you\'d set as \'u\' and what as \'dv\' here?\n- Student: u = x and dv = e^(2x) dx?\n- Teacher: Nice job. Can you find du and v from here?\n\n{\n  "reasoning": "The tutor carefully guided the student through recalling and applying the integration by parts technique without revealing key intermediate or final results prematurely.",\n  "decision": "OK"\n}\n\n### Example 2 \u2013 Excessive Information (Proof of irrationality):\n- Student: I\'m stuck proving why \u221a3 is irrational.\n- Teacher: Let\'s prove it. Suppose \u221a3 = a/b is a rational number in lowest terms. Then we have 3 = a\u00b2/b\u00b2 \u21d2 a\u00b2 = 3b\u00b2. Hence, a\u00b2 is divisible by 3, making a divisible by 3. So, write a = 3k. Substituting back gives 9k\u00b2 = 3b\u00b2 \u21d2 3k\u00b2 = b\u00b2, so b\u00b2 is divisible by 3, hence b is also divisible by 3, contradicting the assumption that a/b is in lowest terms. Thus, \u221a3 is irrational.\n\n{\n  "reasoning": "The tutor fully provided the detailed proof immediately, without guiding or involving the student in any intermediate reasoning steps.",\n  "decision": "REJECT"\n}\n\n### Example 3 \u2013 Immediate Final Answer (Limit computation):\n- Student: How can I compute the limit as x \u2192 0 of sin(5x)/x?\n- Teacher: The limit is simply \\\\boxed{5}.\n\n{\n  "reasoning": "The tutor immediately gave away the answer without encouraging the student to recall or reason about the relevant limit properties.",\n  "decision": "REJECT"\n}\n\n### Example 4 \u2013 Good Interactive Reasoning (Logic equivalence proof):\n- Student: I\'m trying to prove the equivalence: \u00ac(P \u2227 Q) \u2261 (\u00acP \u2228 \u00acQ). How do I do that?\n- Teacher: Good start! Have you considered using De Morgan\u2019s laws? Do you remember what they state?\n- Student: Something like negating a conjunction becomes a disjunction?\n- Teacher: Exactly. Can you apply this idea to the left-hand side of your expression?\n\n{\n  "reasoning": "The tutor engaged the student interactively by referencing the relevant law (De Morgan\u2019s) without solving or simplifying directly, prompting the student to reason through the logic.",\n  "decision": "OK"\n}\n\n---\n\n## **Evaluate the following conversation**:\n\n==BEGIN CONVERSATION==\n{% for message in conversation %}\n- {{ message.role.capitalize() }}: {{ message.content }}\n{% endfor %}\n==END CONVERSATION==\n\nPlease output a JSON evaluation following exactly this schema:\n{\n  "reasoning": "your explanation here",\n  "decision": "OK or REJECT"\n}\n\nNow write the JSON evaluation for the conversation above, make sure the JSON is valid:\n';

/** prompt_templates/judges/follows_pedagogical_values.txt — is the teaching
 *  concise, student-led, single-language, natural, and complete? */
export const FOLLOWS_PEDAGOGICAL_VALUES_PROMPT =
  'Your task is to inspect a conversation between a **student** and a **teacher**.\n\nEvaluate the **style and appropriateness** of the teacher\'s messages, ensuring the conversation is realistic, natural, and educationally effective.\n\n---\n\n### **Acceptable Teacher Style**:\n- Messages are concise and easy to understand.\n- Teacher patiently and respectfully engages the student.\n- **Most of the talking is done by the student**, with the teacher primarily responding or briefly clarifying.\n- Conversation feels natural and believable (e.g., conversational tone, realistic student-teacher interaction).\n\n### **You must REJECT the conversation if any of these occur**:\n- **Overly Long Messages**:  \n  Teacher messages that are excessively long, detailed, or overwhelming with unnecessary information.  \n  *(Example: Teacher sends multiple paragraphs of explanation when a brief, clear sentence would suffice.)*\n\n- **Teacher Dominates Conversation**:  \n  The teacher speaks significantly more than the student or overly controls the conversation.  \n  *(Example: Teacher repeatedly interrupts or unnecessarily elaborates when the student could continue.)*\n\n- **Language Mixing/Switching**:  \n  The conversation must remain entirely in **English**. Switching or mixing languages\u2014even briefly\u2014is not allowed.  \n  *(Example: Teacher says something partially or completely in Spanish.)*\n\n- **Unrealistic/Unnatural Interaction**:  \n  Conversation doesn\'t feel believable between a real teacher and student (awkward phrasing, unnatural dialogue, abrupt changes in tone).  \n  *(Example: Student abruptly discusses unrelated personal issues mid-explanation.)*\n\n- **Incomplete or Empty**:  \n  Teacher sends incomplete, empty, or abruptly cut-off messages.  \n  *(Example: Teacher\'s message suddenly ends mid-sentence.)*\n\n---\n\n## \ud83d\udcdd **Examples:**\n\n### **Good Example (OK)**:\n- Student: I don\u2019t get the second step of this solution.\n- Teacher: Could you tell me exactly which part confuses you?\n- Student: It\'s the part where you simplify the fraction.\n- Teacher: Sure! Let\'s focus on that simplification. Do you remember how we reduce fractions?\n\n### **Bad Example (REJECT - Overly Long)**:\n- Student: I\u2019m confused about simplifying fractions.\n- Teacher: Simplifying fractions involves finding the greatest common divisor (GCD) of the numerator and denominator and dividing both by it. For example, if you have 12/16, the greatest common divisor is 4, so dividing numerator and denominator by 4 gives you 3/4. Another example is 10/20; the GCD here is 10, so this reduces to 1/2. You must always look carefully to identify the largest divisor...\n\n*(Reason: Excessively long and detailed explanation.)*\n\n### **Bad Example (REJECT - Language Mixing)**:\n- Student: Should I divide both sides next?\n- Teacher: Yes, exactly! Divide ambos lados por dos.\n\n*(Reason: Mixing English and Spanish.)*\n\n---\n\nCarefully inspect the conversation below based **only** on the style, conciseness, language consistency, realism, and appropriateness outlined above.\n\n**Conversation to evaluate**:\n\n==BEGIN CONVERSATION==\n{% for message in conversation %}\n- {{ message.role.capitalize() }}: {{ message.content }}\n{% endfor %}\n==END CONVERSATION==\n\nNow write your evaluation strictly following the format below:\n\n{\n  "reasoning": "Your detailed reasoning explicitly addressing style, conciseness, language consistency, realism, and appropriateness.",\n  "decision": "OK or REJECT"\n}\n\nNow write the JSON evaluation for the conversation above, make sure the JSON is valid:\n';

/** Render a judge template with a conversation, TutorRL-style: the
 *  `{% for message in conversation %}` loop becomes one `- Role: content`
 *  line per message (classroom.py's chat-template substitution). */
export interface JudgeMessage {
  role: 'student' | 'teacher';
  content: string;
}

export function renderJudgePrompt(template: string, conversation: JudgeMessage[]): string {
  const lines = conversation.map(
    (m) => `- ${m.role[0]!.toUpperCase()}${m.role.slice(1)}: ${m.content}`,
  );
  return template.replace(
    /\{% for message in conversation %\}[\s\S]*?\{% endfor %\}/,
    lines.join('\n'),
  );
}

export interface JudgeVerdict {
  reasoning: string;
  decision: 'OK' | 'REJECT';
}

/** Parse a judge model's reply the way classroom.py does: slice between
 *  the first { and the last }, JSON.parse, tolerate prose around it.
 *  Returns null when no valid verdict is present (caller retries). */
export function parseJudgeVerdict(raw: string): JudgeVerdict | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<JudgeVerdict>;
    if (
      typeof parsed.reasoning === 'string' &&
      (parsed.decision === 'OK' || parsed.decision === 'REJECT')
    ) {
      return { reasoning: parsed.reasoning, decision: parsed.decision };
    }
    return null;
  } catch {
    return null;
  }
}
