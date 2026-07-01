use git2::{
    build::{CheckoutBuilder, RepoBuilder},
    BranchType, CherrypickOptions, Commit, Cred, DiffFormat, DiffOptions, ErrorCode, FetchOptions, Index, Status, StatusOptions,
    MergeOptions, Oid, RebaseOptions, RemoteCallbacks, Repository, ResetType,
};
use reqwest::{blocking::Client, Url};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use thiserror::Error;

#[derive(Default)]
struct AppState {
    repo_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Http(#[from] reqwest::Error),
    #[error("No repository is open")]
    NoRepository,
    #[error("Object is not a commit: {0}")]
    NotCommit(String),
    #[error("Branch not found: {0}")]
    BranchNotFound(String),
    #[error("Cannot continue because the index still has conflicts")]
    ConflictsRemain,
    #[error("{0}")]
    InvalidRemoteBaseUrl(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type AppResult<T> = Result<T, AppError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchDto {
    name: String,
    shorthand: String,
    target: Option<String>,
    is_head: bool,
    is_remote: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommitNodeDto {
    id: String,
    short_id: String,
    summary: String,
    message: String,
    author: String,
    email: String,
    time: i64,
    parents: Vec<String>,
    branches: Vec<String>,
    x: i32,
    y: i32,
    lane: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommitChangedFileDto {
    path: String,
    old_path: Option<String>,
    status: String,
    additions: usize,
    deletions: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitDetailsDto {
    commit_id: String,
    files: Vec<CommitChangedFileDto>,
    patch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictFileDto {
    path: String,
    ancestor: String,
    ours: String,
    theirs: String,
    result: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkingTreeFileDto {
    path: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryStateDto {
    path: String,
    head: Option<String>,
    branches: Vec<BranchDto>,
    commits: Vec<CommitNodeDto>,
    conflicts: Vec<ConflictFileDto>,
    working_tree_changes: Vec<WorkingTreeFileDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationResultDto {
    status: String,
    message: String,
    state: RepositoryStateDto,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum GitProvider {
    GitLab,
    GitHub,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
struct GitLabProjectDto {
    id: u64,
    name: String,
    path_with_namespace: String,
    web_url: String,
    http_url_to_repo: String,
    ssh_url_to_repo: String,
    default_branch: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
struct RemoteProjectDto {
    id: u64,
    provider: GitProvider,
    name: String,
    path_with_namespace: String,
    web_url: String,
    http_url_to_repo: String,
    ssh_url_to_repo: String,
    default_branch: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRepoDto {
    id: u64,
    name: String,
    full_name: String,
    html_url: String,
    clone_url: String,
    ssh_url: String,
    default_branch: Option<String>,
}

#[tauri::command]
fn open_repository(path: String, state: State<AppState>) -> AppResult<RepositoryStateDto> {
    let repo = Repository::open(&path)?;
    *state.repo_path.lock().expect("repo mutex poisoned") = Some(repo.path().to_path_buf());
    repository_state(&repo)
}

#[tauri::command]
fn clone_repository(
    provider: GitProvider,
    remote_url: String,
    destination: String,
    token: String,
    state: State<AppState>,
) -> AppResult<RepositoryStateDto> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, _allowed_types| {
        if token.is_empty() {
            Cred::default()
        } else {
            let username = match provider {
                GitProvider::GitHub => "x-access-token",
                GitProvider::GitLab => username_from_url.unwrap_or("oauth2"),
            };
            Cred::userpass_plaintext(username, &token)
        }
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch_options);
    let repo = builder.clone(&remote_url, Path::new(&destination))?;
    *state.repo_path.lock().expect("repo mutex poisoned") = Some(repo.path().to_path_buf());
    repository_state(&repo)
}

#[tauri::command]
fn list_remote_projects(
    provider: GitProvider,
    base_url: String,
    token: String,
    search: String,
) -> AppResult<Vec<RemoteProjectDto>> {
    match provider {
        GitProvider::GitLab => gitlab_list_projects(base_url, token, search),
        GitProvider::GitHub => github_list_projects(base_url, token, search),
    }
}

fn gitlab_list_projects(
    base_url: String,
    token: String,
    search: String,
) -> AppResult<Vec<RemoteProjectDto>> {
    let base = base_url.trim().trim_end_matches('/');
    let url = format!("{base}/api/v4/projects");
    let client = Client::new();
    let mut request = client
        .get(url)
        .header("PRIVATE-TOKEN", token)
        .query(&[
            ("membership", "true"),
            ("simple", "true"),
            ("order_by", "last_activity_at"),
            ("sort", "desc"),
            ("per_page", "50"),
        ]);

    let search = search.trim();
    if !search.is_empty() {
        request = request.query(&[("search", search)]);
    }

    let projects: Vec<GitLabProjectDto> = request.send()?.error_for_status()?.json()?;
    Ok(projects
        .into_iter()
        .map(|project| RemoteProjectDto {
            id: project.id,
            provider: GitProvider::GitLab,
            name: project.name,
            path_with_namespace: project.path_with_namespace,
            web_url: project.web_url,
            http_url_to_repo: project.http_url_to_repo,
            ssh_url_to_repo: project.ssh_url_to_repo,
            default_branch: project.default_branch,
        })
        .collect())
}

fn github_list_projects(
    base_url: String,
    token: String,
    search: String,
) -> AppResult<Vec<RemoteProjectDto>> {
    let api_base = github_api_base(&base_url)?;
    let search = search.trim().to_lowercase();
    let url = format!("{api_base}/user/repos");
    let client = Client::new();
    let repos: Vec<GitHubRepoDto> = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "GitCrack")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .query(&[
            ("visibility", "all"),
            ("affiliation", "owner,collaborator,organization_member"),
            ("sort", "updated"),
            ("per_page", "100"),
        ])
        .send()?
        .error_for_status()?
        .json()?;

    Ok(repos
        .into_iter()
        .filter(|repo| {
            search.is_empty()
                || repo.name.to_lowercase().contains(&search)
                || repo.full_name.to_lowercase().contains(&search)
        })
        .map(|repo| RemoteProjectDto {
            id: repo.id,
            provider: GitProvider::GitHub,
            name: repo.name,
            path_with_namespace: repo.full_name,
            web_url: repo.html_url,
            http_url_to_repo: repo.clone_url,
            ssh_url_to_repo: repo.ssh_url,
            default_branch: repo.default_branch,
        })
        .collect())
}

fn github_api_base(base_url: &str) -> AppResult<String> {
    let url = Url::parse(base_url)
        .map_err(|error| AppError::InvalidRemoteBaseUrl(format!("Invalid GitHub URL: {error}")))?;
    let host = url
        .host_str()
        .ok_or_else(|| AppError::InvalidRemoteBaseUrl("GitHub URL is missing a host".to_string()))?;
    let origin = if let Some(port) = url.port() {
        format!("{}://{}:{}", url.scheme(), host, port)
    } else {
        format!("{}://{}", url.scheme(), host)
    };
    let path = url.path().trim_end_matches('/');

    if host.eq_ignore_ascii_case("github.com") {
        Ok("https://api.github.com".to_string())
    } else if path.is_empty() || path == "/" || path == "/api/v3" {
        Ok(format!("{origin}/api/v3"))
    } else {
        Err(AppError::InvalidRemoteBaseUrl(
            "Use https://github.com, your GitHub Enterprise base URL, or an API URL ending with /api/v3".to_string(),
        ))
    }
}

#[tauri::command]
fn get_repository_state(state: State<AppState>) -> AppResult<RepositoryStateDto> {
    let repo = open_current_repo(&state)?;
    repository_state(&repo)
}

#[tauri::command]
fn checkout_ref(ref_name: String, state: State<AppState>) -> AppResult<RepositoryStateDto> {
    let repo = open_current_repo(&state)?;
    if let Ok(full_name) = canonical_branch_ref(&repo, &ref_name) {
        let object = repo.revparse_single(&full_name)?;
        let mut checkout = CheckoutBuilder::new();
        checkout.safe();
        repo.checkout_tree(&object, Some(&mut checkout))?;
        repo.set_head(&full_name)?;
    } else {
        let object = repo.revparse_single(&ref_name)?;
        let mut checkout = CheckoutBuilder::new();
        checkout.safe();
        repo.checkout_tree(&object, Some(&mut checkout))?;
        repo.set_head_detached(object.id())?;
    }

    repository_state(&repo)
}

#[tauri::command]
fn merge_branch(source: String, target: String, state: State<AppState>) -> AppResult<OperationResultDto> {
    let repo = open_current_repo(&state)?;
    checkout_branch(&repo, &target)?;

    let source_commit = branch_commit(&repo, &source)?;
    let annotated = repo.find_annotated_commit(source_commit.id())?;
    let mut merge_options = MergeOptions::new();
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.merge(&[&annotated], Some(&mut merge_options), Some(&mut checkout))?;

    let mut index = repo.index()?;
    if index.has_conflicts() {
        return operation_result(&repo, "conflicts", format!("Merge has conflicts: {source} into {target}"));
    }

    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let head_commit = head_commit(&repo)?;
    let signature = repo.signature()?;
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &format!("Merge branch '{source}' into {target}"),
        &tree,
        &[&head_commit, &source_commit],
    )?;
    repo.cleanup_state()?;
    operation_result(&repo, "clean", format!("Merged {source} into {target}"))
}

#[tauri::command]
fn rebase_branch(source: String, target: String, state: State<AppState>) -> AppResult<OperationResultDto> {
    let repo = open_current_repo(&state)?;
    checkout_branch(&repo, &source)?;

    let upstream = branch_commit(&repo, &target)?;
    let upstream = repo.find_annotated_commit(upstream.id())?;
    let mut options = RebaseOptions::new();
    let mut rebase = repo.rebase(None, Some(&upstream), None, Some(&mut options))?;
    let signature = repo.signature()?;

    while rebase.next().transpose()?.is_some() {
        let mut index = repo.index()?;
        if index.has_conflicts() {
            return operation_result(&repo, "conflicts", format!("Rebase has conflicts: {source} onto {target}"));
        }
        rebase.commit(None, &signature, None)?;
    }

    rebase.finish(Some(&signature))?;
    operation_result(&repo, "clean", format!("Rebased {source} onto {target}"))
}

#[tauri::command]
fn cherry_pick(commit_sha: String, target_branch: String, state: State<AppState>) -> AppResult<OperationResultDto> {
    let repo = open_current_repo(&state)?;
    checkout_branch(&repo, &target_branch)?;

    let oid = Oid::from_str(&commit_sha)?;
    let commit = repo.find_commit(oid)?;
    let mut options = CherrypickOptions::new();
    repo.cherrypick(&commit, Some(&mut options))?;

    let mut index = repo.index()?;
    if index.has_conflicts() {
        return operation_result(&repo, "conflicts", format!("Cherry-pick has conflicts: {}", short_oid(commit.id())));
    }

    commit_index_with_parent(&repo, &mut index, &format!("Cherry-pick: {}", commit.summary().unwrap_or("commit")))?;
    repo.cleanup_state()?;
    operation_result(&repo, "clean", format!("Cherry-picked {}", short_oid(commit.id())))
}

#[tauri::command]
fn get_diff(base: String, head: String, state: State<AppState>) -> AppResult<String> {
    let repo = open_current_repo(&state)?;
    let base_commit = repo.find_commit(Oid::from_str(&base)?)?;
    let head_commit = repo.find_commit(Oid::from_str(&head)?)?;
    let base_tree = base_commit.tree()?;
    let head_tree = head_commit.tree()?;
    let diff = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), None)?;
    let mut out = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        out.push(line.origin());
        out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;
    Ok(out)
}

#[tauri::command]
fn get_commit_details(commit_sha: String, state: State<AppState>) -> AppResult<CommitDetailsDto> {
    let repo = open_current_repo(&state)?;
    let commit = repo.find_commit(Oid::from_str(&commit_sha)?)?;
    let old_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let new_tree = commit.tree()?;
    let mut diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)?;
    let _ = diff.find_similar(None);

    let mut files = Vec::<CommitChangedFileDto>::new();
    let mut file_by_path = HashMap::<String, usize>::new();

    for delta in diff.deltas() {
        let path = delta_path_string(&delta);
        file_by_path.insert(path.clone(), files.len());
        files.push(CommitChangedFileDto {
            old_path: delta.old_file().path().map(|path| path.to_string_lossy().to_string()),
            status: delta_status_label(delta.status()).to_string(),
            path,
            additions: 0,
            deletions: 0,
        });
    }

    let mut patch = String::new();
    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        let path = delta_path_string(&delta);
        if let Some(index) = file_by_path.get(&path).copied() {
            match line.origin() {
                '+' => files[index].additions += 1,
                '-' => files[index].deletions += 1,
                _ => {}
            }
        }
        patch.push(line.origin());
        patch.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;

    if patch.is_empty() {
        patch.push_str("No changes for this commit against the selected base.\n");
    }

    Ok(CommitDetailsDto {
        commit_id: commit.id().to_string(),
        files,
        patch,
    })
}

#[tauri::command]
fn get_working_tree_diff(file_path: Option<String>, state: State<AppState>) -> AppResult<String> {
    let repo = open_current_repo(&state)?;
    working_tree_diff(&repo, file_path.as_deref())
}

#[tauri::command]
fn save_conflict_resolution(
    file_path: String,
    content: String,
    state: State<AppState>,
) -> AppResult<RepositoryStateDto> {
    let repo = open_current_repo(&state)?;
    let workdir = repo.workdir().ok_or(AppError::NoRepository)?;
    let target = workdir.join(&file_path);
    std::fs::write(target, content)?;

    let mut index = repo.index()?;
    index.add_path(Path::new(&file_path))?;
    index.write()?;
    repository_state(&repo)
}

#[tauri::command]
fn continue_operation(state: State<AppState>) -> AppResult<OperationResultDto> {
    let repo = open_current_repo(&state)?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(AppError::ConflictsRemain);
    }
    commit_index_with_parent(&repo, &mut index, "Complete Git operation")?;
    repo.cleanup_state()?;
    operation_result(&repo, "clean", "Operation completed".to_string())
}

#[tauri::command]
fn abort_operation(state: State<AppState>) -> AppResult<RepositoryStateDto> {
    let repo = open_current_repo(&state)?;
    if let Ok(mut rebase) = repo.open_rebase(None) {
        rebase.abort()?;
    }
    let head = repo.head()?.peel_to_commit()?;
    repo.reset(head.as_object(), ResetType::Hard, None)?;
    repo.cleanup_state()?;
    repository_state(&repo)
}

fn open_current_repo(state: &State<AppState>) -> AppResult<Repository> {
    let path = state
        .repo_path
        .lock()
        .expect("repo mutex poisoned")
        .clone()
        .ok_or(AppError::NoRepository)?;
    Ok(Repository::open(path)?)
}

fn repository_state(repo: &Repository) -> AppResult<RepositoryStateDto> {
    let branches = list_branches(repo)?;
    let commits = list_commits(repo, &branches)?;
    let conflicts = list_conflicts(repo)?;
    let working_tree_changes = list_working_tree_changes(repo)?;
    let head = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(ToOwned::to_owned));
    let path = repo
        .workdir()
        .unwrap_or_else(|| repo.path())
        .to_string_lossy()
        .to_string();

    Ok(RepositoryStateDto {
        path,
        head,
        branches,
        commits,
        conflicts,
        working_tree_changes,
    })
}

fn list_branches(repo: &Repository) -> AppResult<Vec<BranchDto>> {
    let mut branches = Vec::new();
    for branch_type in [BranchType::Local, BranchType::Remote] {
        for branch in repo.branches(Some(branch_type))? {
            let (branch, kind) = branch?;
            let reference = branch.get();
            branches.push(BranchDto {
                name: reference.name().unwrap_or_default().to_string(),
                shorthand: branch.name()?.unwrap_or_default().to_string(),
                target: reference.target().map(|oid| oid.to_string()),
                is_head: branch.is_head(),
                is_remote: kind == BranchType::Remote,
            });
        }
    }
    branches.sort_by(|a, b| a.shorthand.cmp(&b.shorthand));
    Ok(branches)
}

fn list_commits(repo: &Repository, branches: &[BranchDto]) -> AppResult<Vec<CommitNodeDto>> {
    let mut branch_by_oid: HashMap<String, Vec<String>> = HashMap::new();
    let mut tips = Vec::new();
    for branch in branches {
        if let Some(target) = &branch.target {
            branch_by_oid
                .entry(target.clone())
                .or_default()
                .push(branch.shorthand.clone());
            if let Ok(oid) = Oid::from_str(target) {
                tips.push(oid);
            }
        }
    }

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
    if tips.is_empty() {
        if revwalk.push_head().is_err() {
            return Ok(Vec::new());
        }
    } else {
        for tip in tips {
            let _ = revwalk.push(tip);
        }
    }

    let mut commits = Vec::new();
    let mut lane_by_oid: HashMap<String, usize> = HashMap::new();

    for (row, oid) in revwalk.take(600).enumerate() {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let id = oid.to_string();
        let lane = lane_by_oid
            .remove(&id)
            .unwrap_or_else(|| first_free_lane(lane_by_oid.values().copied()));

        for (parent_index, parent) in commit.parent_ids().enumerate() {
            let parent = parent.to_string();
            let parent_lane = if parent_index == 0 {
                lane
            } else {
                first_free_lane(lane_by_oid.values().copied().chain(std::iter::once(lane)))
            };
            lane_by_oid.entry(parent).or_insert(parent_lane);
        }

        commits.push(commit_dto(&commit, row, lane, branch_by_oid.get(&id).cloned().unwrap_or_default())?);
    }

    Ok(commits)
}

fn commit_dto(commit: &Commit<'_>, row: usize, lane: usize, branches: Vec<String>) -> AppResult<CommitNodeDto> {
    let id = commit.id().to_string();
    Ok(CommitNodeDto {
        short_id: short_oid(commit.id()),
        id,
        summary: commit.summary().unwrap_or("(no summary)").to_string(),
        message: commit.message().unwrap_or_default().to_string(),
        author: commit.author().name().unwrap_or("Unknown").to_string(),
        email: commit.author().email().unwrap_or_default().to_string(),
        time: commit.time().seconds(),
        parents: commit.parent_ids().map(|oid| oid.to_string()).collect(),
        branches,
        x: 76 + lane as i32 * 92,
        y: 54 + row as i32 * 74,
        lane,
    })
}

fn list_conflicts(repo: &Repository) -> AppResult<Vec<ConflictFileDto>> {
    let index = repo.index()?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }

    let mut conflicts = Vec::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let path = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|entry| String::from_utf8_lossy(&entry.path).to_string())
            .unwrap_or_else(|| "(unknown)".to_string());
        conflicts.push(ConflictFileDto {
            result: read_workdir_file(repo, &path).unwrap_or_default(),
            ancestor: conflict
                .ancestor
                .as_ref()
                .and_then(|entry| blob_to_string(repo, entry.id).ok())
                .unwrap_or_default(),
            ours: conflict
                .our
                .as_ref()
                .and_then(|entry| blob_to_string(repo, entry.id).ok())
                .unwrap_or_default(),
            theirs: conflict
                .their
                .as_ref()
                .and_then(|entry| blob_to_string(repo, entry.id).ok())
                .unwrap_or_default(),
            path,
        });
    }
    Ok(conflicts)
}

fn list_working_tree_changes(repo: &Repository) -> AppResult<Vec<WorkingTreeFileDto>> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut options))?;
    let mut files = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        if status.is_empty() || status == Status::CURRENT {
            continue;
        }

        let path = entry
            .path()
            .map(ToOwned::to_owned)
            .or_else(|| {
                entry.head_to_index()
                    .and_then(|delta| delta.new_file().path().or(delta.old_file().path()))
                    .map(|path| path.to_string_lossy().to_string())
            })
            .or_else(|| {
                entry.index_to_workdir()
                    .and_then(|delta| delta.new_file().path().or(delta.old_file().path()))
                    .map(|path| path.to_string_lossy().to_string())
            });

        if let Some(path) = path {
            files.push(WorkingTreeFileDto {
                path,
                status: status_label(status).to_string(),
            });
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    files.dedup_by(|a, b| a.path == b.path);
    Ok(files)
}

fn working_tree_diff(repo: &Repository, file_path: Option<&str>) -> AppResult<String> {
    let mut out = String::new();
    let mut has_output = false;

    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let mut staged_options = DiffOptions::new();
    if let Some(path) = file_path {
        staged_options.pathspec(path);
    }
    let index = repo.index()?;
    let staged = repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut staged_options))?;
    has_output |= print_named_diff(&mut out, "Staged changes", &staged)?;

    let mut unstaged_options = DiffOptions::new();
    if let Some(path) = file_path {
        unstaged_options.pathspec(path);
    }
    let index = repo.index()?;
    let unstaged = repo.diff_index_to_workdir(Some(&index), Some(&mut unstaged_options))?;
    has_output |= print_named_diff(&mut out, "Unstaged changes", &unstaged)?;

    if !has_output {
        out.push_str("No local changes.\n");
    }

    Ok(out)
}

fn print_named_diff(out: &mut String, title: &str, diff: &git2::Diff<'_>) -> AppResult<bool> {
    if diff.deltas().len() == 0 {
        return Ok(false);
    }

    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str("# ");
    out.push_str(title);
    out.push_str("\n\n");

    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        out.push(line.origin());
        out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;

    Ok(true)
}

fn delta_path_string(delta: &git2::DiffDelta<'_>) -> String {
    delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "(unknown)".to_string())
}

fn delta_status_label(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Modified => "modified",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Copied => "copied",
        git2::Delta::Typechange => "typechange",
        git2::Delta::Untracked => "untracked",
        git2::Delta::Conflicted => "conflicted",
        _ => "changed",
    }
}

fn status_label(status: Status) -> &'static str {
    if status.is_conflicted() {
        "conflicted"
    } else if status.is_wt_new() || status.is_index_new() {
        "new"
    } else if status.is_wt_deleted() || status.is_index_deleted() {
        "deleted"
    } else if status.is_wt_renamed() || status.is_index_renamed() {
        "renamed"
    } else if status.is_wt_typechange() || status.is_index_typechange() {
        "typechange"
    } else if status.is_wt_modified() || status.is_index_modified() {
        "modified"
    } else {
        "changed"
    }
}

fn blob_to_string(repo: &Repository, oid: Oid) -> AppResult<String> {
    let blob = repo.find_blob(oid)?;
    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

fn read_workdir_file(repo: &Repository, path: &str) -> AppResult<String> {
    let workdir = repo.workdir().ok_or(AppError::NoRepository)?;
    Ok(std::fs::read_to_string(workdir.join(path))?)
}

fn checkout_branch(repo: &Repository, branch: &str) -> AppResult<()> {
    let full_name = canonical_branch_ref(repo, branch)?;
    let object = repo.revparse_single(&full_name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(&object, Some(&mut checkout))?;
    repo.set_head(&full_name)?;
    Ok(())
}

fn canonical_branch_ref(repo: &Repository, branch: &str) -> AppResult<String> {
    for candidate in [branch.to_string(), format!("refs/heads/{branch}"), format!("refs/remotes/{branch}")] {
        match repo.find_reference(&candidate) {
            Ok(reference) => return Ok(reference.name().unwrap_or(&candidate).to_string()),
            Err(error) if error.code() == ErrorCode::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Err(AppError::BranchNotFound(branch.to_string()))
}

fn branch_commit<'repo>(repo: &'repo Repository, branch: &str) -> AppResult<Commit<'repo>> {
    let full_name = canonical_branch_ref(repo, branch)?;
    let reference = repo.find_reference(&full_name)?;
    reference
        .peel_to_commit()
        .map_err(|_| AppError::NotCommit(branch.to_string()))
}

fn head_commit(repo: &Repository) -> AppResult<Commit<'_>> {
    repo.head()?
        .peel_to_commit()
        .map_err(|_| AppError::NotCommit("HEAD".to_string()))
}

fn commit_index_with_parent(repo: &Repository, index: &mut Index, message: &str) -> AppResult<Oid> {
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let parent = head_commit(repo)?;
    let signature = repo.signature()?;
    let oid = repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &[&parent])?;
    index.write()?;
    Ok(oid)
}

fn operation_result(repo: &Repository, status: &str, message: String) -> AppResult<OperationResultDto> {
    Ok(OperationResultDto {
        status: status.to_string(),
        message,
        state: repository_state(repo)?,
    })
}

fn short_oid(oid: Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

fn first_free_lane(used: impl Iterator<Item = usize>) -> usize {
    let used: HashSet<usize> = used.collect();
    (0..64).find(|lane| !used.contains(lane)).unwrap_or(0)
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            clone_repository,
            list_remote_projects,
            get_repository_state,
            checkout_ref,
            merge_branch,
            rebase_branch,
            cherry_pick,
            get_diff,
            get_commit_details,
            get_working_tree_diff,
            save_conflict_resolution,
            continue_operation,
            abort_operation
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitCrack");
}
