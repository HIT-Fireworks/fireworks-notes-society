<script setup lang="ts">
import type { CourseDetailData } from "../course-catalog";

const { course } = defineProps<{ course: CourseDetailData }>();

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
const readableBytes = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};
</script>

<template>
  <article class="course-detail">
    <nav class="course-breadcrumb" aria-label="面包屑">
      <a href="/courses/">课程中心</a><span>/</span
      ><span>{{ course.name }}</span>
    </nav>

    <header class="detail-hero">
      <div>
        <div class="detail-badges">
          <span class="course-code">{{ course.code }}</span>
          <span
            :class="['material-state', course.hasMaterial ? 'ready' : 'empty']"
          >
            {{ course.hasMaterial ? "已有课程资料" : "资料待补充" }}
          </span>
        </div>
        <h1>{{ course.name }}</h1>
        <p v-if="course.aliases.length" class="aliases">
          也叫：{{ course.aliases.slice(0, 5).join("、") }}
        </p>
        <div class="hero-meta">
          <span v-for="college in course.offeringColleges" :key="college">{{
            college
          }}</span>
          <span v-for="term in course.terms" :key="term">{{
            readableTerm(term)
          }}</span>
        </div>
      </div>
      <div class="resource-meter">
        <strong>{{ course.fileCount }}</strong
        ><span>个资料文件</span>
        <small>{{ readableBytes(course.bytes) }}</small>
      </div>
    </header>

    <section class="info-section">
      <header>
        <p>COURSE PROFILE</p>
        <h2>课程基本信息</h2>
      </header>
      <dl class="info-grid">
        <div>
          <dt>课程代码</dt>
          <dd>{{ course.code }}</dd>
        </div>
        <div>
          <dt>学分</dt>
          <dd>{{ course.credits.join(" / ") || "未标注" }}</dd>
        </div>
        <div>
          <dt>总学时</dt>
          <dd>
            {{
              course.totalHours.map((value) => `${value} 学时`).join(" / ") ||
              "未标注"
            }}
          </dd>
        </div>
        <div>
          <dt>考核方式</dt>
          <dd>{{ course.assessmentMethods.join(" / ") || "未标注" }}</dd>
        </div>
        <div>
          <dt>课程性质</dt>
          <dd>{{ course.courseNatures.join(" / ") || "未标注" }}</dd>
        </div>
        <div>
          <dt>课程类别</dt>
          <dd>{{ course.courseCategories.join(" / ") || "未标注" }}</dd>
        </div>
      </dl>
    </section>

    <section class="info-section">
      <header>
        <p>WHERE IT APPEARS</p>
        <h2>哪些专业会学这门课</h2>
      </header>
      <div v-if="course.majors.length" class="major-table-wrap">
        <table class="major-table">
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
              <td>{{ item.school }}</td>
              <td>{{ item.major }}</td>
              <td>{{ readableTerm(item.term) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="section-empty">培养方案中暂无专业覆盖信息。</p>
    </section>

    <section class="info-section resources-section">
      <header>
        <p>COURSE MATERIALS</p>
        <h2>课程资料</h2>
      </header>
      <div v-if="course.repositories.length" class="repository-grid">
        <article
          v-for="repository in course.repositories"
          :key="repository.repoId"
          class="repository-card"
        >
          <div>
            <span class="repo-label">HIT-Fireworks</span>
            <h3>{{ repository.displayName }}</h3>
            <p>
              {{ repository.fileCount }} 个文件 ·
              {{ readableBytes(repository.bytes) }}
            </p>
          </div>
          <div v-if="repository.categories.length" class="category-list">
            <span
              v-for="category in repository.categories"
              :key="category.name"
            >
              {{ category.name }} {{ category.count }}
            </span>
          </div>
          <a
            :href="repository.githubUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            在 GitHub 查看资料 <span aria-hidden="true">↗</span>
          </a>
        </article>
      </div>
      <div v-else class="contribution-callout">
        <div>
          <strong>这门课还没有资料</strong>
          <p>如果你有笔记、试卷、作业或经验，欢迎成为第一个贡献者。</p>
        </div>
        <a
          href="https://github.com/HIT-Fireworks/fireworks-notes-society/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          >提交资料线索</a
        >
      </div>
    </section>

    <footer class="detail-footer">
      <a href="/courses/">← 返回课程中心</a>
      <a
        v-if="course.repoId"
        :href="`https://github.com/HIT-Fireworks/${course.repoId}`"
        target="_blank"
        rel="noopener noreferrer"
        >课程仓库 ↗</a
      >
    </footer>
  </article>
</template>

<style scoped>
.course-detail {
  max-width: 980px;
  margin: 0 auto;
  padding: 26px 24px 80px;
  color: var(--vp-c-text-1);
}
.course-breadcrumb {
  display: flex;
  gap: 9px;
  align-items: center;
  margin: 8px 0 32px;
  color: var(--vp-c-text-3);
  font-size: 13px;
}
.course-breadcrumb a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 30px;
  align-items: end;
  padding: 34px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 26px;
  background: linear-gradient(135deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  box-shadow: var(--vp-shadow-2);
}
.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.course-code {
  padding: 5px 9px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.material-state {
  padding: 5px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
.material-state.ready {
  color: var(--vp-c-green-1);
  background: var(--vp-c-green-soft);
}
.material-state.empty {
  color: var(--vp-c-text-3);
  background: var(--vp-c-default-soft);
}
.detail-hero h1 {
  margin: 18px 0 8px;
  border: 0;
  font-size: clamp(34px, 5vw, 54px);
  line-height: 1.08;
  letter-spacing: -0.035em;
}
.aliases {
  margin: 0 0 18px;
  color: var(--vp-c-text-2);
}
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.hero-meta span {
  padding: 5px 9px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.resource-meter {
  display: flex;
  min-height: 140px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border-radius: 20px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  text-align: center;
}
.resource-meter strong {
  font-size: 36px;
  line-height: 1;
}
.resource-meter span {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 700;
}
.resource-meter small {
  margin-top: 14px;
  color: var(--vp-c-text-2);
}
.info-section {
  margin-top: 48px;
}
.info-section > header {
  margin-bottom: 18px;
}
.info-section > header p {
  margin: 0 0 5px;
  color: var(--vp-c-brand-1);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.info-section > header h2 {
  margin: 0;
  border: 0;
  font-size: 25px;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 0;
}
.info-grid div {
  padding: 17px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 15px;
  background: var(--vp-c-bg-soft);
}
.info-grid dt {
  color: var(--vp-c-text-3);
  font-size: 11px;
}
.info-grid dd {
  margin: 7px 0 0;
  font-weight: 700;
}
.major-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
}
.major-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.major-table th,
.major-table td {
  padding: 13px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  text-align: left;
}
.major-table th {
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  font-size: 12px;
}
.major-table tbody tr:last-child td {
  border-bottom: 0;
}
.repository-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
.repository-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 18px;
  background: var(--vp-c-bg-soft);
}
.repo-label {
  color: var(--vp-c-brand-1);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.repository-card h3 {
  margin: 7px 0 4px;
  border: 0;
  font-size: 18px;
}
.repository-card p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.category-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 18px 0;
}
.category-list span {
  padding: 4px 7px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
  font-size: 11px;
}
.repository-card a {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-brand-1);
  font-weight: 700;
  text-decoration: none;
}
.contribution-callout {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  padding: 22px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 18px;
  background: var(--vp-c-bg-soft);
}
.contribution-callout strong {
  display: block;
}
.contribution-callout p {
  margin: 4px 0 0;
  color: var(--vp-c-text-2);
}
.contribution-callout a {
  padding: 10px 14px;
  border-radius: 10px;
  color: white;
  background: var(--vp-c-brand-1);
  text-decoration: none;
  white-space: nowrap;
}
.section-empty {
  color: var(--vp-c-text-2);
}
.detail-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 54px;
  padding-top: 22px;
  border-top: 1px solid var(--vp-c-divider);
}
.detail-footer a {
  color: var(--vp-c-brand-1);
  font-weight: 700;
  text-decoration: none;
}
@media (max-width: 700px) {
  .course-detail {
    padding: 18px 14px 60px;
  }
  .detail-hero {
    grid-template-columns: 1fr;
    padding: 22px;
  }
  .resource-meter {
    min-height: 100px;
  }
  .info-grid,
  .repository-grid {
    grid-template-columns: 1fr;
  }
  .contribution-callout,
  .detail-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .contribution-callout a {
    text-align: center;
  }
}
</style>
