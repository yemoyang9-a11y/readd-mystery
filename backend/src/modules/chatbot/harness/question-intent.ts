export type QuestionIntent =
  | 'fact'
  | 'verify_hypothesis'
  | 'culprit_or_ending'
  | 'prediction'
  | 'outside';

const PREDICTION =
  /(앞으로|다음\s*(?:장|화|에|엔|편)?|이후|곧|뒤에).{0,14}(어떻게\s*(?:될|전개|흘러)|무슨\s*일|누가\s*(?:죽|나올|등장|잡)|벌어질|일어날|될까|나올까|죽을까)|예측|예상해|전개.{0,6}(?:어떨|어떻게)|what\s+(?:happens|will happen)|predict|will\s+\w+\s+(?:die|be\s+caught)/iu;

const CULPRIT_OR_ENDING =
  /범인|진범|살인자|흉수|결말|엔딩|정체|잡혀|체포|해결(?:돼|되|될)|밝혀(?:져|지|질)|(?:이야기|사건|소설|책)[^.?!]{0,6}(?:끝나|끝이)|누가\s*[^.?!]{0,12}(?:죽였|죽인|살해|살인|범행|그랬|한\s*짓)|(?:죽인|살해한|저지른)\s*(?:거|것|짓|사람|자)|(?:이|가)\s*한\s*(?:거|것|짓)\s*(?:아니|맞|지)|마지막\s*(?:장|에|엔)|끝에\s*(?:가|서)?\s*(?:어떻게|누구)|누가\s*(?:죽였|범행)|정체가?\s*(?:뭐|누구|무엇)|사건의?\s*진상|culprit|killer|murderer|whodunit|ending|who\s+did\s+it/iu;

const INJECTION_OR_ROLEPLAY =
  /(?:이전|위|앞(?:의|선)?|기존)\s*(?:지시|명령|규칙|지침)[^.?!]{0,10}(?:무시|잊|취소|해제)|시스템\s*프롬프트|개발자\s*모드|탈옥|(?:너는|넌|당신은)\s*이제[^.?!]{0,16}(?:이야|입니다|야)|역할\s*극|롤\s*플레이|(?:작가|탐정|범인)(?:인\s*척|처럼|역할)|ignore\s+(?:all\s+)?(?:previous|prior|above)|system\s+prompt|developer\s+mode|jailbreak|role-?play|pretend\s+(?:to\s+be|you)|you\s+are\s+now/iu;

const VERIFY_HYPOTHESIS =
  /가설|추리|추측|내\s*생각|제\s*생각|의심|수상|공범|배후|용의자|동기|알리바이|트릭|복선|반전|떡밥|한\s*짓|노트에?\s*(?:적|쓴|있)|(?:내가|제가)\s*(?:적은|쓴)|예\s*\/\s*아니오|예\s*아니오|yes\s*(?:or|\/)\s*no|hypothesis|theory/iu;

const OUTSIDE =
  /작가(?:의|가)?[^.?!]{0,14}(?:의도|생각|인터뷰)|날씨|주식|코딩|프로그래밍|레시피|번역해|다른\s*(?:책|소설|작품)|영화|드라마|author'?s?\s+intent|weather/iu;

export function classifyQuestion(text: string): QuestionIntent {
  // FR-QNA-004 🚦 R9
  if (PREDICTION.test(text)) return 'prediction';
  if (CULPRIT_OR_ENDING.test(text) || INJECTION_OR_ROLEPLAY.test(text)) return 'culprit_or_ending';
  if (VERIFY_HYPOTHESIS.test(text)) return 'verify_hypothesis';
  if (OUTSIDE.test(text)) return 'outside';
  return 'fact';
}
