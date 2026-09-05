<script lang="ts">
import type { CourseDetailFile } from "../course-catalog";

export function serializeResourceFiles(files: CourseDetailFile[]): string {
  return Buffer.from(JSON.stringify(files), "utf8").toString("base64");
}
</script>

<script setup lang="ts">
import type { CourseDetailData, CourseDetailFile } from "../course-catalog";
import ResourceFileList from "./ResourceFileList.vue";

const { course } = defineProps<{ course: CourseDetailData }>();
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
      <div
        v-if="resourceFiles.length"
        id="course-resource-root"
        :data-files="serializeResourceFiles(resourceFiles)"
      >
        <ResourceFileList :files="resourceFiles" />
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
      <div v-if="course.repositories.length" class="material-sources">
        <span>资料来源</span>
        <ul>
          <li
            v-for="repository in course.repositories"
            :key="repository.repoId"
          >
            <a
              :href="repository.githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{
                course.repositories.length === 1
                  ? "GitHub"
                  : repository.displayName
              }}</a
            >
          </li>
        </ul>
      </div>
    </section>

    <div class="course-supplement">
      <details class="course-disclosure">
        <summary>培养方案中的安排</summary>
        <table v-if="course.majors.length" class="curriculum-table">
          <thead>
            <tr>
              <th>培养学院</th>
              <th>专业</th>
              <th>推荐学期</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in course.majors"
              :key="`${item.school}-${item.major}-${item.term}`"
            >
              <td data-label="培养学院">{{ item.school }}</td>
              <td data-label="专业">{{ item.major }}</td>
              <td data-label="推荐学期">{{ readableTerm(item.term) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="arrangements-empty">培养方案中暂无专业覆盖信息。</p>
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
.material-sources {
  display: flex;
  align-items: baseline;
  gap: 8px 12px;
  margin-top: 12px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.material-sources > span {
  flex-shrink: 0;
}
.material-sources ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
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
  table-layout: fixed;
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
    grid-template-columns: 5rem minmax(0, 1fr);
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
