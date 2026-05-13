"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileUpload, type FileUploadValue } from "@/components/ui/file-upload";
import { StepIndicator } from "@/components/ui/step-indicator";
import {
  USER_IDENTITY_OPTIONS,
  EDUCATION_OPTIONS,
  WORK_YEARS_OPTIONS,
} from "@/lib/form-options";
import { startReportPrefetch, clearReportPrefetch } from "@/lib/report-prefetch";
import { clearBgSections } from "@/lib/report-bg-runner";
import { startQuizPrefetch, clearQuizPrefetch } from "@/lib/quiz-prefetch";
import { blessAudio } from "@/lib/audio-bless";
import type { JobFormData, UserIdentity } from "@/lib/types";

const formSchema = z.object({
  identity: z.enum(["recent_grad", "young_unemployed", "general_unemployed"], {
    error: "请选择当前身份",
  }),
  targetPosition: z.string().max(60, "岗位名称过长").optional(),
  education: z.string().min(1, "请选择最高学历"),
  workYears: z.string().min(1, "请选择工作年限"),
});

type FormValues = z.infer<typeof formSchema>;

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

function getSavedDefaults(): Partial<FormValues> & {
  resume: FileUploadValue | null;
} {
  const empty = {
    identity: undefined,
    targetPosition: "",
    education: "",
    workYears: "",
    resume: null,
  };
  if (typeof window === "undefined") return empty;
  try {
    const saved = sessionStorage.getItem("formData");
    if (!saved) return empty;
    const parsed = JSON.parse(saved) as Partial<JobFormData>;
    return {
      identity: parsed.identity,
      targetPosition: parsed.targetPosition ?? "",
      education: parsed.education ?? "",
      workYears: parsed.workYears ?? "",
      resume:
        parsed.resumeText && parsed.resumeFileName
          ? { fileName: parsed.resumeFileName, text: parsed.resumeText }
          : null,
    };
  } catch {
    return empty;
  }
}

export default function HomePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeError, setResumeError] = useState(false);
  const saved = getSavedDefaults();
  const [resume, setResume] = useState<FileUploadValue | null>(saved.resume);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      identity: saved.identity,
      targetPosition: saved.targetPosition ?? "",
      education: saved.education ?? "",
      workYears: saved.workYears ?? "",
    },
  });

  const watchedValues = watch();

  const selectedIdentity = watchedValues.identity;

  const onSubmit = (data: FormValues) => {
    if (isSubmitting) return;
    if (!resume?.text) {
      setResumeError(true);
      return;
    }
    setIsSubmitting(true);
    blessAudio();
    const payload: JobFormData = {
      identity: data.identity as UserIdentity,
      targetPosition: data.targetPosition ?? "",
      education: data.education,
      workYears: data.workYears,
      resumeText: resume?.text,
      resumeFileName: resume?.fileName,
    };
    sessionStorage.setItem("formData", JSON.stringify(payload));
    // 用户从入口重新填表，清掉所有下游缓存：
    // 量表答案 / 报告数据 / 访谈 Q3Q4 锁定 / 简历 ref / 简历文件名
    sessionStorage.removeItem("quizAnswers");
    sessionStorage.removeItem("reportData");
    sessionStorage.removeItem("q3q4Lock");
    sessionStorage.removeItem("interviewQ1Q2");
    sessionStorage.removeItem("micPermission");
    if (resume?.resumeRef) sessionStorage.setItem("resumeRef", resume.resumeRef);
    else sessionStorage.removeItem("resumeRef");
    if (resume?.resumeFilename) sessionStorage.setItem("resumeFilename", resume.resumeFilename);
    else sessionStorage.removeItem("resumeFilename");
    // career-nav 里 5 模块全部依赖 quiz/Q1Q2，本阶段无可预拉项；保留 stub 调用
    // 仅为对齐项目里历史 import 习惯。
    startReportPrefetch(payload);
    // 🚀 Layer 3 优化：在页面跳转前立即触发 LLM 生成，
    // quiz page mount 时可直接消费已在途的 Promise，节省 ~2-3s 页面过渡时间
    startQuizPrefetch(payload);
    router.push("/preparing");
  };

  useEffect(() => {
    // 用户返回入口重新填写：清理旧的预拉取，防止提交新表单后拿到旧数据
    clearReportPrefetch();
    clearQuizPrefetch(); // 清掉上次的 quiz 预触发（用户重填时身份/学历可能变）
    clearBgSections(); // 用户回入口重填时清掉 quiz 阶段启动的后台任务
    // 后台预编译路由（dev 模式消除首次跳转的"Compiling..."等待）
    router.prefetch("/preparing");
    router.prefetch("/quiz");
  }, [router]);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />

      <div className="fixed top-20 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--blue-200)] to-[var(--blue-100)] opacity-40 blur-3xl" />
      <div className="fixed -bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[var(--blue-300)] to-[var(--blue-100)] opacity-30 blur-3xl" />

      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: cubicEase }}
          className="mb-8 sm:mb-10"
        >
          {/* Category badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--blue-500)]/8 border border-[var(--blue-500)]/12 mb-3">
            <div className="size-1.5 rounded-full bg-[var(--blue-500)]" />
            <span className="text-xs font-medium text-[var(--blue-600)] tracking-wide">
              就业服务
            </span>
          </div>

          <h1
            className="text-[2rem] sm:text-4xl font-bold text-[var(--navy-900)] mb-3 tracking-tight leading-tight text-balance"
            style={{ fontFamily: '"Songti SC", "SimSun", "Noto Serif SC", serif' }}
          >
            智能职业导航
          </h1>

          <StepIndicator currentStep={0} compact className="mb-5" />

          <p className="text-sm sm:text-base text-[var(--muted-foreground)] leading-relaxed">
            仅需三步，就可以定制一份属于你的职业导航报告
          </p>
        </motion.div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 sm:space-y-5"
        >
          {/* 1. 身份选择 —— 双卡片 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: cubicEase }}
          >
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <Label className="flex items-center gap-2 text-sm font-medium text-[var(--navy-800)] mb-3">
                <span className="text-[var(--blue-500)]">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M3.5 17c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                你的当前身份
                <span className="text-red-400 text-xs">*</span>
              </Label>

              <div className="grid grid-cols-1 gap-2.5">
                {USER_IDENTITY_OPTIONS.map((opt) => {
                  const active = selectedIdentity === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setValue("identity", opt.value, { shouldValidate: true })
                      }
                      aria-pressed={active}
                      className={[
                        "relative text-left rounded-xl border px-4 py-3 transition-all active:scale-[0.98]",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]/40",
                        "flex items-center justify-between gap-2",
                        active
                          ? "border-[var(--blue-500)] bg-[var(--blue-50)] shadow-sm ring-1 ring-[var(--blue-500)]/20"
                          : "border-[var(--blue-200)] bg-white/60 hover:border-[var(--blue-300)] hover:bg-white/80",
                      ].join(" ")}
                    >
                      <span className="text-[15px] font-semibold text-[var(--navy-900)]">
                        {opt.label}
                      </span>
                      <span
                        className={[
                          "shrink-0 size-5 rounded-full border-2 flex items-center justify-center transition-colors",
                          active
                            ? "border-[var(--blue-500)] bg-[var(--blue-500)]"
                            : "border-[var(--blue-300)] bg-white",
                        ].join(" ")}
                        aria-hidden
                      >
                        {active && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* 隐藏 input 让 RHF 注册 identity 字段 */}
              <input type="hidden" {...register("identity")} />

              {errors.identity && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-500 mt-2 flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6 4v2.5M6 8h.005" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {errors.identity.message}
                </motion.p>
              )}
            </div>
          </motion.div>

          {/* 2. 目标岗位 —— 自由文本 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: cubicEase }}
          >
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <Label
                htmlFor="targetPosition"
                className="flex items-center gap-2 text-sm font-medium text-[var(--navy-800)] mb-3"
              >
                <span className="text-[var(--blue-500)]">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7 7h6M7 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                目标岗位（选填）
              </Label>
              <Input
                id="targetPosition"
                placeholder="例如：产品经理、前端工程师、行政专员"
                {...register("targetPosition")}
                className="h-12 text-base md:text-sm bg-white/60 border-[var(--blue-200)] focus:border-[var(--blue-400)] focus:ring-2 focus:ring-[var(--blue-500)]/20 transition-all placeholder:text-[var(--muted-foreground)]/50"
              />
              {errors.targetPosition && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-500 mt-2 flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6 4v2.5M6 8h.005" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {errors.targetPosition.message}
                </motion.p>
              )}
            </div>
          </motion.div>

          {/* 3. 最高学历 —— 下拉 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.26, ease: cubicEase }}
          >
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <Label
                htmlFor="education"
                className="flex items-center gap-2 text-sm font-medium text-[var(--navy-800)] mb-3"
              >
                <span className="text-[var(--blue-500)]">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M10 3L1.5 7 10 11l8.5-4L10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M5 9v4c0 1.66 2.24 3 5 3s5-1.34 5-3V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                最高学历
                <span className="text-red-400 text-xs">*</span>
              </Label>
              <Select
                value={watchedValues.education}
                onValueChange={(val) =>
                  setValue("education", val ?? "", { shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="education"
                  className="w-full !h-12 text-base md:text-sm bg-white/60 border-[var(--blue-200)] focus:border-[var(--blue-400)] focus:ring-2 focus:ring-[var(--blue-500)]/20 transition-all data-[placeholder]:text-[var(--muted-foreground)]/50"
                >
                  <SelectValue placeholder="选择最高学历">
                    {watchedValues.education
                      ? (EDUCATION_OPTIONS.find((o) => o.value === watchedValues.education)?.label ?? "选择最高学历")
                      : "选择最高学历"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {EDUCATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.education && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-500 mt-2 flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6 4v2.5M6 8h.005" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {errors.education.message}
                </motion.p>
              )}
            </div>
          </motion.div>

          {/* 4. 工作年限 —— 下拉 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.34, ease: cubicEase }}
          >
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <Label
                htmlFor="workYears"
                className="flex items-center gap-2 text-sm font-medium text-[var(--navy-800)] mb-3"
              >
                <span className="text-[var(--blue-500)]">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                工作年限
                <span className="text-red-400 text-xs">*</span>
              </Label>
              <Select
                value={watchedValues.workYears}
                onValueChange={(val) =>
                  setValue("workYears", val ?? "", { shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="workYears"
                  className="w-full !h-12 text-base md:text-sm bg-white/60 border-[var(--blue-200)] focus:border-[var(--blue-400)] focus:ring-2 focus:ring-[var(--blue-500)]/20 transition-all data-[placeholder]:text-[var(--muted-foreground)]/50"
                >
                  <SelectValue placeholder="选择工作年限">
                    {watchedValues.workYears
                      ? (WORK_YEARS_OPTIONS.find((o) => o.value === watchedValues.workYears)?.label ?? "选择工作年限")
                      : "选择工作年限"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {WORK_YEARS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.workYears && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-500 mt-2 flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6 4v2.5M6 8h.005" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {errors.workYears.message}
                </motion.p>
              )}
            </div>
          </motion.div>

          {/* 5. 简历上传（可选） */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.42, ease: cubicEase }}
          >
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <Label className="flex items-center gap-2 text-sm font-medium text-[var(--navy-800)] mb-3">
                <span className="text-[var(--blue-500)]">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M12 2H5a1 1 0 00-1 1v14a1 1 0 001 1h10a1 1 0 001-1V6l-4-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M12 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M7 11h6M7 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                简历上传
                <span className="text-red-400 text-xs">*</span>
              </Label>
              <p className="text-xs text-[var(--muted-foreground)] mb-3">
                上传后，AI 将结合你的教育、工作、项目经验，给出个性化的分析和简历诊断
              </p>
              <FileUpload
                value={resume}
                onChange={(v) => { setResume(v); if (v) setResumeError(false); }}
                accept=".pdf,.doc,.docx"
                maxSizeMB={5}
              />
              {resumeError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-500 mt-2 flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6 4v2.5M6 8h.005" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  请上传简历
                </motion.p>
              )}
            </div>
          </motion.div>

          {/* 6. 提交按钮 —— 移动端 sticky 底部 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5, ease: cubicEase }}
            className="pt-2 sm:pt-4"
          >
            <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 text-base font-medium bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-700)] hover:brightness-110 active:brightness-95 text-white rounded-xl btn-glow transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed group"
              >
                <span className="flex items-center gap-2">
                  {isSubmitting ? "提交中…" : "下一步"}
                  {!isSubmitting && (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      className="transition-transform duration-200 group-hover:translate-x-0.5"
                    >
                      <path
                        d="M6.5 4L12 9l-5.5 5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </Button>
              <p className="text-center text-xs text-[var(--muted-foreground)] mt-3 sm:mt-4">
                以上信息仅用于本次报告生成
              </p>
          </motion.div>
        </form>
      </div>
    </div>
  );
}
