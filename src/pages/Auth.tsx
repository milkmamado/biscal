import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import { ArrowLeft, Mail, Shield, Zap, TrendingUp, Beaker } from 'lucide-react';

const authSchema = z.object({
  email: z.string().trim().email({ message: "올바른 이메일 주소를 입력하세요" }),
  password: z.string().min(6, { message: "비밀번호는 최소 6자 이상이어야 합니다" })
});

type AuthStep = 'credentials' | 'otp' | 'mode-select';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<AuthStep>('credentials');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingOtp, setPendingOtp] = useState(false);
  const { signIn, signUp, user, loading } = useAuth();
  const navigate = useNavigate();
  

  // 로그인 후 자동 리다이렉트 제거 - 대신 mode-select 화면 표시

  const sendVerificationCode = async (targetEmail: string) => {
    const { data, error } = await supabase.functions.invoke('send-verification-code', {
      body: { email: targetEmail }
    });

    if (error) {
      throw new Error(error.message || '인증 코드 발송 실패');
    }

    return data;
  };

  const verifyCode = async (targetEmail: string, code: string) => {
    const { data, error } = await supabase.functions.invoke('verify-code', {
      body: { email: targetEmail, code }
    });

    if (error) {
      throw new Error(error.message || '인증 실패');
    }

    return data;
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      console.log("입력 오류:", result.error.errors[0].message);
    }

    setIsLoading(true);

    try {
      if (isLogin) {
        // 먼저 로그인 시도로 계정 유효성 검증
        const { error } = await signIn(email, password);
        if (error) {
          let message = "로그인에 실패했습니다";
          if (error.message.includes("Invalid login credentials")) {
            message = "이메일 또는 비밀번호가 올바르지 않습니다";
          }
          console.log("로그인 실패:", message);
          setIsLoading(false);
          return;
        }

        // 로그인 성공 후 로그아웃하고 OTP 발송
        await supabase.auth.signOut();
        
        // 인증 코드 발송
        await sendVerificationCode(email);
        setPendingOtp(true);
        console.log("인증 코드 발송: 이메일로 6자리 인증 코드를 발송했습니다");
        setStep('otp');
      } else {
        const { error } = await signUp(email, password);
        if (error) {
          let message = "회원가입에 실패했습니다";
          if (error.message.includes("already registered")) {
            message = "이미 가입된 이메일입니다";
          }
          console.log("회원가입 실패:", message);
        } else {
          console.log("회원가입 성공: 로그인해주세요");
          setIsLogin(true);
        }
      }
    } catch (error: any) {
      console.error("오류:", error.message || "처리 중 오류가 발생했습니다");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (otpCode.length !== 6) {
      console.log("입력 오류: 6자리 인증 코드를 입력하세요");
      return;
    }

    setIsLoading(true);

    try {
      const verifyResult = await verifyCode(email, otpCode);
      
      if (!verifyResult.valid) {
        console.log("인증 실패: 잘못된 인증 코드이거나 만료되었습니다");
        return;
      }

      setPendingOtp(false);
      const { error } = await signIn(email, password);
      if (error) {
        console.log("로그인 실패: 로그인 중 오류가 발생했습니다");
        return;
      }

      console.log("로그인 성공: 환영합니다!");
      // 바로 현물매매로 이동 (선택화면 스킵)
      navigate('/');
    } catch (error: any) {
      console.error("인증 실패:", error.message || "인증 코드 확인에 실패했습니다");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    try {
      await sendVerificationCode(email);
      console.log("재발송 완료: 새로운 인증 코드를 발송했습니다");
      setOtpCode('');
    } catch (error: any) {
      console.error("발송 실패:", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setStep('credentials');
    setOtpCode('');
    setPendingOtp(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="neon-text-cyan animate-pulse">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Cyberpunk Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Grid lines */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0, 255, 255, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 255, 255, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* Gradient orbs */}
        <div className="absolute top-1/4 -left-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-purple-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px]" />
        
        {/* Scan lines */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 255, 0.1) 2px, rgba(0, 255, 255, 0.1) 4px)',
          }}
        />
      </div>

      {/* Main Card */}
      <div className="relative w-full max-w-md">
        {/* Glow effect behind card */}
        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 rounded-2xl blur-xl opacity-50" />
        
        <div className="relative bg-card/80 backdrop-blur-xl border border-cyan-500/20 rounded-2xl p-8 shadow-2xl">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-cyan-400/50 rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-cyan-400/50 rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-cyan-400/50 rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-cyan-400/50 rounded-br-2xl" />

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black tracking-widest mb-2 font-mono">
              <span className="neon-text-cyan neon-pulse">BISCAL</span>
            </h1>
            <div className="flex items-center justify-center gap-2 text-xs text-cyan-400/60 font-mono">
              <Zap className="h-3 w-3" />
              <span>FUTURES SCALPING TERMINAL</span>
              <Zap className="h-3 w-3" />
            </div>
            <div className="mt-3 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
          </div>

          {step === 'credentials' ? (
            <>
              <form onSubmit={handleCredentialsSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-cyan-300/80 text-xs font-mono flex items-center gap-2 uppercase tracking-wider">
                    <Mail className="h-3 w-3" />
                    Email Address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background/50 border-cyan-500/30 text-foreground font-mono placeholder:text-muted-foreground/50 focus:border-cyan-400 focus:ring-cyan-400/20 transition-all"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-cyan-300/80 text-xs font-mono uppercase tracking-wider">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-background/50 border-cyan-500/30 text-foreground font-mono placeholder:text-muted-foreground/50 focus:border-cyan-400 focus:ring-cyan-400/20 transition-all"
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono font-bold tracking-wider transition-all duration-300 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/40"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">◌</span>
                      PROCESSING...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      {isLogin ? 'ACCESS SYSTEM' : 'REGISTER'}
                    </span>
                  )}
                </Button>
              </form>
              
              {/* Toggle between login and signup - 임시 숨김 */}
              {/* <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-xs text-cyan-400/60 hover:text-cyan-400 transition-colors font-mono"
                >
                  {isLogin ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
                </button>
              </div> */}
            </>
          ) : step === 'otp' ? (
            <div className="space-y-6">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1 text-xs text-cyan-400/60 hover:text-cyan-400 transition-colors font-mono uppercase tracking-wider"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>

              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <div className="p-4 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                    <Shield className="h-8 w-8 text-cyan-400" />
                  </div>
                </div>
                <div>
                  <p className="text-cyan-300 font-mono font-bold tracking-wider">VERIFICATION REQUIRED</p>
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    Enter 6-digit code sent to<br />
                    <span className="text-cyan-400">{email}</span>
                  </p>
                </div>
              </div>

              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={setOtpCode}
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot 
                        key={index}
                        index={index} 
                        className="bg-background/50 border-cyan-500/30 text-cyan-400 font-mono text-lg w-10 h-12"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button 
                onClick={handleOtpSubmit}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono font-bold tracking-wider shadow-lg shadow-cyan-500/25"
                disabled={isLoading || otpCode.length !== 6}
              >
                {isLoading ? 'VERIFYING...' : 'CONFIRM ACCESS'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={isLoading}
                  className="text-xs text-cyan-400/50 hover:text-cyan-400 transition-colors font-mono uppercase tracking-wider disabled:opacity-50"
                >
                  Resend Code
                </button>
              </div>
            </div>
          ) : (
            /* Mode Selection Screen */
            <div className="space-y-6">
              <div className="text-center space-y-3">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-green-500/10 border border-green-500/30">
                    <Zap className="h-6 w-6 text-green-400" />
                  </div>
                </div>
                <div>
                  <p className="text-green-400 font-mono font-bold tracking-wider text-sm">ACCESS GRANTED</p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    Select trading mode
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <Button 
                  onClick={() => navigate('/')}
                  className="w-full h-16 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono font-bold tracking-wider transition-all duration-300 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/40"
                >
                  <div className="flex items-center gap-4">
                    <TrendingUp className="h-6 w-6" />
                    <div className="flex items-center gap-2 text-lg tracking-[0.2em]">
                      {['飛', '蛾', '赴', '火'].map((char, i) => (
                        <span 
                          key={i} 
                          className="neon-text-cyan"
                          style={{ animationDelay: `${i * 0.1}s` }}
                        >
                          {char}
                        </span>
                      ))}
                    </div>
                  </div>
                </Button>

                <Button 
                  onClick={() => navigate('/paper-trading')}
                  variant="outline"
                  className="w-full h-16 border-fuchsia-500/40 text-fuchsia-400 hover:bg-fuchsia-500/10 hover:border-fuchsia-400/60 hover:text-fuchsia-300 font-mono tracking-wider transition-all duration-300 shadow-lg shadow-fuchsia-500/10 hover:shadow-fuchsia-500/20"
                >
                  <div className="flex items-center gap-4">
                    <Beaker className="h-6 w-6" />
                    <div className="flex items-center gap-2 text-lg tracking-[0.2em]">
                      {['模', '擬', '鍛', '鍊'].map((char, i) => (
                        <span 
                          key={i} 
                          className="neon-text-fuchsia"
                          style={{ animationDelay: `${i * 0.1}s` }}
                        >
                          {char}
                        </span>
                      ))}
                    </div>
                  </div>
                </Button>
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className="mt-8 pt-4 border-t border-cyan-500/10">
            <div className="flex items-center justify-between text-[10px] text-cyan-500/40 font-mono">
              <span>SYS::AUTH_PORTAL</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                ONLINE
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

