# 재난상황판 수집기

Node.js 24 이상에서 저장소 최상위 위치에서 실행합니다.

    node collector/collect.mjs

입출력: web/data.json 하나. _state에는 수집 예정시각·잠금·하루 호출수·이전 응답 캐시가 들어갑니다. API 키는 환경변수로만 읽고 JSON 저장 전에 키 포함 여부를 검사합니다. 기존 JSON이 손상됐으면 덮어쓰지 않습니다.

SAFETYDATA_MESSAGES_KEY, SAFETYDATA_WATER_KEY, SAFETYDATA_RAIN_KEY, SAFETYDATA_FIRE_KEY, SAFETYDATA_LANDSLIDE_KEY, SAFETYDATA_PREDICTION_KEY, SAFETYDATA_POP_KEY, SAFETYDATA_RAIN6_KEY, KMA_API_KEY, AIRKOREA_API_KEY를 GitHub Secrets에서 환경변수로 연결해야 합니다.

수집 내용: 재난자료 8개, 경기도 기상특보, 의정부시청 대표 실황·예보 및 의정부 대표 대기질. 동별 날씨는 수집하지 않습니다. 대기질 측정소는 대표 측정소 미수신 시 관내 측정소를 대체 사용합니다. 일부 대기질 추가 예보는 이용승인이 없으면 실패 상태를 표시하며 다른 수집은 계속합니다.

기존 Sites와 독립적으로 공공 API에서 수집합니다. Sites 서비스 토큰은 사용하지 않습니다. 각 재난 항목 하루 100회 제한, 최소 60분 간격, 수위는 요청 페이지 수에 따라 간격을 늘립니다. 특보는 최소 30분, 대표 날씨는 최소 30분입니다. 실패 시 기존 정상 응답을 보존하고 대기 후 다음 실행에서 재시도합니다.

이 파일 업로드만으로 자동 실행되지 않습니다. 다음 단계에서 collect.yml 워크플로를 추가해야 합니다. GitHub 수집 작업은 동일한 concurrency 그룹으로 중복 실행을 방지하고, 새 JSON을 저장한 뒤 사이트 게시 워크플로를 실행해야 합니다.

검증: 오프라인 실패 주입 검사 통과(기존 정상 날씨 유지, 상태 복원, 미래 backoff 호출 금지, 키 유출 방지, 잘못된 JSON 보호, 하루 100회 제한). 실제 인증키를 이용한 API 연결은 GitHub 첫 실행에서 확인해야 합니다.
