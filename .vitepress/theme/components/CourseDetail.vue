<script lang="ts">
import type { CourseDetailFile } from "../course-catalog";

export function serializeResourceFiles(files: CourseDetailFile[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(files));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
</script>

<script setup lang="ts">
import type {
  CourseDetailData,
  CourseDetailFile,
  CourseDetailPlan,
} from "../course-catalog";
import RepositoryResources from "./RepositoryResources.vue";

const { course, plans } = defineProps<{
  course: CourseDetailData;
  plans: CourseDetailPlan[];
}>();
const resourceFiles: CourseDetailFile[] = course.files;

const readableTerm = (term: string) =>
  term
    .replace("第一学年", "大一 · ")
    .replace("第二学年", "大二 · ")
    .replace("第三学年", "大三 · ")
    .replace("第四学年", "大四 · ")
    .replace("第五学年", "大五 · ")
    .replace("秋季", "秋")
    .replace("春季", "春")
    .replace("夏季", "夏");
const sourceLabel = (sourceKind: "curriculum" | "execution") =>
  sourceKind === "execution" ? "执行教学计划" : "培养方案";
type DetailArrangement = CourseDetailData["majors"][number];
const arrangementPlan = (item: DetailArrangement) => plans[item.planIndex];
const planIdentity = (item: DetailArrangement) => {
  const plan = arrangementPlan(item);
  return plan.sourceKind === "execution"
    ? plan.entryCohort
      ? `${plan.entryCohort} 级`
      : "入学年级未标注"
    : plan.planVersion || "版本未标注";
};
const majorLabel = (item: DetailArrangement) => {
  const plan = arrangementPlan(item);
  return [
    plan.majorFullName || plan.majorName || "专业名称未标注",
    plan.programType,
  ]
    .filter(Boolean)
    .join(" · ");
};
const sectionLabel = (item: DetailArrangement) => {
  const labels: Record<string, string> = {
    "curriculum-main": "培养方案课程",
    "curriculum-requirements": "培养要求",
    "execution-main": "执行教学计划课程",
    "execution-module": "模块课程要求",
    "execution-double-degree-minor": "双学位与辅修要求",
  };
  const label = labels[item.sourceSection ?? ""] ?? "安排来源未标注";
  const relation = [
    item.moduleId ? `模块：${item.moduleId}` : "",
    item.directionKey && item.directionKey !== "0"
      ? `方向：${item.directionKey}`
      : "",
  ];
  return [label, ...relation].filter(Boolean).join(" · ");
};
</script>

<template>
  <article class="course-detail">
    <nav class="course-breadcrumb" aria-label="面包屑">
      <a href="/courses/">课程中心</a>
      <span aria-hidden="true">/</span>
      <span class="course-code" aria-current="page">{{ course.code }}</span>
    </nav>

    <header class="course-heading">
      <h1>{{ course.name }}</h1>
      <p v-if="course.name === course.code">教务未提供名称</p>
    </header>

    <dl class="course-highlights" aria-label="课程基本信息">
      <div class="info-card">
        <dt>学分</dt>
        <dd>{{ course.credits.join(" / ") || "未标注" }}</dd>
      </div>
      <div class="info-card">
        <dt>总学时</dt>
        <dd>{{ course.totalHours.join(" / ") || "未标注" }}</dd>
      </div>
      <div class="info-card">
        <dt>考核方式</dt>
        <dd>{{ course.assessmentMethods.join(" / ") || "未标注" }}</dd>
      </div>
      <div class="info-card">
        <dt>课程性质</dt>
        <dd>{{ course.courseNatures.join(" / ") || "未标注" }}</dd>
        <dt class="category-label">课程类别</dt>
        <dd class="category-value">
          {{ course.courseCategories.join(" / ") || "未标注" }}
        </dd>
      </div>
      <div class="info-card info-card-wide">
        <dt>开课学院</dt>
        <dd>{{ course.offeringColleges.join("、") || "未标注" }}</dd>
      </div>
      <div class="info-card info-card-wide">
        <dt>推荐学期</dt>
        <dd>{{ course.terms.map(readableTerm).join("、") || "未标注" }}</dd>
      </div>
    </dl>

    <section
      class="resources-section"
      aria-labelledby="course-materials-heading"
    >
      <h2 id="course-materials-heading">课程资料</h2>
      <aside
        v-if="course.repositories.length"
        class="repository-coverage"
        aria-label="资料仓库的课程覆盖范围"
      >
        <div
          v-for="repository in course.repositories"
          :key="repository.repoId"
          class="repository-scope"
        >
          <p class="repository-scope-heading">
            <a
              :href="repository.githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{
                course.repositories.length === 1
                  ? "当前资料仓库"
                  : repository.repoId
              }}</a
            >
            包含
            <strong>{{
              repository.courseCodeCount.toLocaleString("zh-CN")
            }}</strong>
            个课程代码
          </p>
          <p
            v-if="repository.courseNamePreview.length"
            class="repository-course-names"
          >
            涉及课程：{{ repository.courseNamePreview.join("、")
            }}<span v-if="repository.courseNameCount !== undefined"
              >……等
              {{ repository.courseNameCount.toLocaleString("zh-CN") }}
              个课程名称</span
            >
          </p>
          <p v-else class="repository-course-names">
            这些课程代码暂未提供课程名称。
          </p>
        </div>
        <p class="material-ownership-note" role="note">
          请注意分辨资料归属：同一仓库可能收录不同课程的资料，请结合文件名、课程代码和内容确认。
        </p>
      </aside>
      <div
        v-if="resourceFiles.length"
        data-resource-root
        :data-files="serializeResourceFiles(resourceFiles)"
      >
        <RepositoryResources :files="resourceFiles" />
      </div>
      <div v-else class="materials-empty">
        <p>这门课暂时没有可浏览的资料。</p>
        <a
          href="https://github.com/HIT-Fireworks/fireworks-notes-society/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          >提交资料线索</a
        >
      </div>
    </section>

    <div class="course-supplement">
      <details class="course-disclosure">
        <summary>教学计划中的安排</summary>
        <table v-if="course.majors.length" class="curriculum-table">
          <thead>
            <tr>
              <th>来源</th>
              <th>版本 / 年级</th>
              <th>培养学院</th>
              <th>专业</th>
              <th>安排</th>
              <th>学期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in course.majors" :key="item.occurrenceId">
              <td data-label="来源">
                {{ sourceLabel(arrangementPlan(item).sourceKind) }}
              </td>
              <td data-label="版本 / 年级">{{ planIdentity(item) }}</td>
              <td data-label="培养学院">
                {{ arrangementPlan(item).school || "未标注" }}
              </td>
              <td data-label="专业">
                {{ majorLabel(item) }}
                <span class="major-code">{{
                  arrangementPlan(item).majorCode || "代码未标注"
                }}</span>
              </td>
              <td data-label="安排">{{ sectionLabel(item) }}</td>
              <td data-label="学期">{{ readableTerm(item.term) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="arrangements-empty">教学计划中暂无专业覆盖信息。</p>
      </details>
    </div>
  </article>
</template>

<style scoped>
.course-detail {
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 24px 72px;
  color: var(--vp-c-text-1);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.course-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.course-detail a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.course-detail a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.course-detail a:focus-visible,
.course-disclosure summary:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
  border-radius: 3px;
}
.course-code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8125rem;
}
.course-heading {
  margin-bottom: 24px;
}
.course-heading h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.02em;
}
.course-highlights {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
  margin: 0 0 28px;
}
.info-card {
  min-width: 0;
  height: 100%;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.info-card dt {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.info-card dd {
  margin: 5px 0 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.5;
}
.info-card-wide {
  grid-column: span 2;
}
.info-card-wide dd {
  font-size: 14px;
}
.info-card .category-label {
  display: inline;
  margin-right: 6px;
}
.info-card .category-value {
  display: inline;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 400;
}
.resources-section h2 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
}
.materials-empty {
  padding: 32px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-align: center;
  font-size: 14px;
}
.materials-empty p {
  margin: 0 0 8px;
  color: var(--vp-c-text-2);
}
.repository-coverage {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
}
.repository-scope + .repository-scope {
  margin-top: 12px;
}
.repository-scope-heading {
  margin: 0;
  color: var(--vp-c-text-1);
}
.repository-course-names {
  margin: 5px 0 0;
  color: var(--vp-c-text-2);
  line-height: 1.8;
}
.material-ownership-note {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  line-height: 1.7;
}
.course-supplement {
  margin-top: 32px;
  border-top: 1px solid var(--vp-c-divider);
}
.course-disclosure {
  border-bottom: 1px solid var(--vp-c-divider);
}
.course-disclosure summary {
  padding: 16px 0;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.course-disclosure summary::marker {
  color: var(--vp-c-text-3);
  font-size: 0.75em;
}
.curriculum-table {
  width: 100%;
  margin: 0 0 20px;
  border-collapse: collapse;
  table-layout: auto;
  text-align: left;
  font-size: 14px;
}
.curriculum-table th,
.curriculum-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  vertical-align: top;
}
.curriculum-table th {
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  font-weight: 500;
}
.curriculum-table tbody tr:last-child td {
  border-bottom: 0;
}
.major-code {
  display: block;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.arrangements-empty {
  margin: 0 0 20px;
  color: var(--vp-c-text-2);
  font-size: 14px;
}
@media (max-width: 600px) {
  .course-detail {
    padding: 24px 16px 48px;
  }
  .course-heading {
    margin-bottom: 24px;
  }
  .course-heading h1 {
    font-size: 26px;
  }
  .course-highlights {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 24px;
  }
  .info-card {
    padding: 12px;
  }
  .curriculum-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .curriculum-table tbody,
  .curriculum-table tr,
  .curriculum-table td {
    display: block;
  }
  .curriculum-table tr {
    padding: 12px 0;
    border-top: 1px solid var(--vp-c-divider);
  }
  .curriculum-table td {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr);
    gap: 12px;
    padding: 3px 0;
    border: 0;
  }
  .curriculum-table td::before {
    content: attr(data-label);
    color: var(--vp-c-text-2);
  }
}
</style>
