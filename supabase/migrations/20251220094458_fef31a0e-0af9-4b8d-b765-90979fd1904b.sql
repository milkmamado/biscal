-- 기존 user_id 유니크 제약조건 삭제
ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_user_id_key;

-- user_id + is_testnet 조합으로 유니크 제약조건 추가 (실거래/테스트넷 각각 1개씩 허용)
ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_user_id_is_testnet_key UNIQUE (user_id, is_testnet);