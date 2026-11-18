import React, { useEffect, useState } from 'react';
import {
  Ban,
  Bookmark,
  Building2,
  Edit3,
  Flag,
  Globe,
  Heart,
  ImagePlus,
  MapPin,
  MessageCircle,
  Pin,
  PinOff,
  QrCode,
  School,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatDateByCalendar, getAllowedAudiencesForRole, type PostAudience } from '../lib/domainRules';
import type { AuthUser } from '../types';

interface SocialModuleProps {
  mode: 'global_feed' | 'my_school' | 'directory' | 'profile';
  user: AuthUser;
  calendar: 'AD' | 'BS';
  searchQuery: string;
}

export const SocialModule: React.FC<SocialModuleProps> = ({ mode, user, calendar, searchQuery }) => {
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [schools, setSchools] = useState<Array<Record<string, unknown>>>([]);
  const [groups, setGroups] = useState<Array<Record<string, unknown>>>([]);
  const [feedFilter, setFeedFilter] = useState<'ALL' | 'FOLLOWING' | 'PROJECTS'>('ALL');
  const [districtFilter, setDistrictFilter] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [selectedSchoolPublic, setSelectedSchoolPublic] = useState<{
    school: Record<string, unknown>;
    posts: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
  } | null>(null);

  // Composer state
  const allowedAudiences = getAllowedAudiencesForRole(user.activeRole);
  const defaultAudienceForMode = (m: typeof mode): PostAudience => {
    if (m === 'my_school') return allowedAudiences.includes('MY_SCHOOL') ? 'MY_SCHOOL' : allowedAudiences[0];
    if (m === 'global_feed') {
      if (allowedAudiences.includes('GLOBAL_COMMUNITY')) return 'GLOBAL_COMMUNITY';
      if (allowedAudiences.includes('PUBLIC')) return 'PUBLIC';
    }
    return allowedAudiences[0];
  };
  const [postContent, setPostContent] = useState('');
  const [postType, setPostType] = useState<'UPDATE' | 'PROJECT' | 'ACHIEVEMENT' | 'ANNOUNCEMENT'>('UPDATE');
  const [audience, setAudience] = useState<PostAudience>(() => defaultAudienceForMode(mode));
  const [uploadedMediaUrl, setUploadedMediaUrl] = useState<string | null>(null);
  const [postStatus, setPostStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Comments drawer
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [commentsMap, setCommentsMap] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [commentInput, setCommentInput] = useState('');

  // Profile tabs
  const [profileTab, setProfileTab] = useState<'posts' | 'saved' | 'groups' | 'connections' | 'about'>('posts');
  const [savedPosts, setSavedPosts] = useState<Array<Record<string, unknown>>>([]);
  const [connections, setConnections] = useState<Array<Record<string, unknown>>>([]);
  const [blockedUsers, setBlockedUsers] = useState<Array<Record<string, unknown>>>([]);
  const [groupForm, setGroupForm] = useState({ name: '', category: 'Science Club', description: '' });
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState('');
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  useEffect(() => {
    setAudience(defaultAudienceForMode(mode));
  }, [mode, user.activeRole]);

  const loadContent = async () => {
    if (mode === 'global_feed') {
      const res = await apiGet<{ posts: Array<Record<string, unknown>> }>(
        `/social/global-feed?filter=${feedFilter}&q=${encodeURIComponent(searchQuery)}`,
        `global_feed:${feedFilter}`
      );
      if (res.success && res.data) setPosts(res.data.posts);
    } else if (mode === 'my_school') {
      const res = await apiGet<{ posts: Array<Record<string, unknown>> }>(
        '/social/my-school-feed',
        `my_school_feed:${user.activeSchoolId}`
      );
      if (res.success && res.data) setPosts(res.data.posts);
    } else if (mode === 'directory') {
      const res = await apiGet<{ schools: Array<Record<string, unknown>> }>(
        `/schools/discover?q=${encodeURIComponent(searchQuery)}&district=${encodeURIComponent(districtFilter)}&province=${encodeURIComponent(provinceFilter)}&country=${encodeURIComponent(countryFilter)}`,
        'schools_directory'
      );
      if (res.success && res.data) setSchools(res.data.schools);
    } else if (mode === 'profile') {
      const [gRes, svRes, fRes, cRes, bRes] = await Promise.all([
        apiGet<{ groups: Array<Record<string, unknown>> }>('/social/groups', 'social:groups'),
        apiGet<{ posts: Array<Record<string, unknown>> }>('/social/saved', `social:saved:${user.userId}`),
        apiGet<{ posts: Array<Record<string, unknown>> }>('/social/global-feed', 'global_feed:ALL'),
        apiGet<{ connections: Array<Record<string, unknown>> }>('/social/connections', `social:conn:${user.userId}`),
        apiGet<{ blocks: Array<Record<string, unknown>> }>('/social/blocks', `social:blocks:${user.userId}`),
      ]);
      if (gRes.success && gRes.data) setGroups(gRes.data.groups);
      if (svRes.success && svRes.data) setSavedPosts(svRes.data.posts);
      if (fRes.success && fRes.data) setPosts(fRes.data.posts.filter((p) => String(p.author_user_id) === user.userId));
      if (cRes.success && cRes.data) setConnections(cRes.data.connections);
      if (bRes.success && bRes.data) setBlockedUsers(bRes.data.blocks);
    }
  };

  useEffect(() => {
    loadContent();
  }, [mode, feedFilter, districtFilter, provinceFilter, countryFilter, searchQuery, user.activeSchoolId]);

  const handleUploadImage = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('visibility', audience === 'PUBLIC' || audience === 'GLOBAL_COMMUNITY' ? 'PUBLIC' : 'SCHOOL_PRIVATE');
    const res = await fetch('/api/v1/files/upload', { method: 'POST', credentials: 'include', body: fd });
    const json = (await res.json()) as { success: boolean; data?: { url: string }; message?: string };
    if (json.success && json.data?.url) {
      setUploadedMediaUrl(json.data.url);
    } else {
      setPostStatus({ ok: false, msg: json.message || 'Image upload failed.' });
    }
  };

  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    setPostStatus(null);
    const res = await apiMutate(
      '/social/posts',
      'POST',
      { content: postContent, postType, audience, mediaUrl: uploadedMediaUrl },
      { queueIfOffline: true, offlineLabel: 'Community Post' }
    );
    if (res.success) {
      setPostContent('');
      setUploadedMediaUrl(null);
      setPostStatus({ ok: true, msg: res.message || 'Published!' });
      loadContent();
    } else {
      setPostStatus({ ok: false, msg: res.message || 'Post blocked.' });
    }
  };

  const handleReact = async (postId: string) => {
    const res = await apiMutate<{ liked: boolean }>(`/social/posts/${postId}/react`, 'POST', { type: 'LIKE' });
    if (res.success && res.data) {
      setPosts((prev) =>
        prev.map((p) =>
          String(p.id) === postId
            ? {
                ...p,
                likedByMe: res.data!.liked,
                likes_count: Number(p.likes_count) + (res.data!.liked ? 1 : -1),
              }
            : p
        )
      );
    }
  };

  const handleSave = async (postId: string) => {
    const res = await apiMutate<{ saved: boolean }>(`/social/posts/${postId}/save`, 'POST', {});
    if (res.success && res.data) {
      setPosts((prev) => prev.map((p) => (String(p.id) === postId ? { ...p, savedByMe: res.data!.saved } : p)));
    }
  };

  const toggleComments = async (postId: string) => {
    if (openCommentsId === postId) {
      setOpenCommentsId(null);
      return;
    }
    setOpenCommentsId(postId);
    const res = await apiGet<{ comments: Array<Record<string, unknown>> }>(`/social/posts/${postId}/comments`);
    if (res.success && res.data) {
      setCommentsMap((m) => ({ ...m, [postId]: res.data!.comments }));
    }
  };

  const handleSendComment = async (postId: string) => {
    if (!commentInput.trim()) return;
    const res = await apiMutate(`/social/posts/${postId}/comment`, 'POST', { body: commentInput });
    if (res.success) {
      setCommentInput('');
      const refreshed = await apiGet<{ comments: Array<Record<string, unknown>> }>(`/social/posts/${postId}/comments`);
      if (refreshed.success && refreshed.data) {
        setCommentsMap((m) => ({ ...m, [postId]: refreshed.data!.comments }));
      }
      loadContent();
    } else {
      setPostStatus({ ok: false, msg: res.message || 'Comment blocked.' });
    }
  };

  const handleReportPost = async (post: Record<string, unknown>) => {
    const res = await apiMutate('/moderation/report', 'POST', {
      targetUserId: String(post.author_user_id),
      contentType: 'POST',
      contentId: String(post.id),
      contentExcerpt: String(post.content).slice(0, 120),
      reason: 'User flagged post for safety review',
    });
    if (res.success) {
      setPostStatus({ ok: true, msg: 'Post reported to Safety Moderation team.' });
    }
  };

  const handleFollowSchool = async (schoolId: string) => {
    const res = await apiMutate<{ following: boolean }>(`/schools/${schoolId}/follow`, 'POST', {});
    if (res.success && res.data) {
      setSchools((prev) =>
        prev.map((s) =>
          String(s.id) === schoolId
            ? {
                ...s,
                isFollowing: res.data!.following,
                followers_count: Number(s.followers_count) + (res.data!.following ? 1 : -1),
              }
            : s
        )
      );
    }
  };

  const openSchoolProfile = async (schoolId: string) => {
    const res = await apiGet<{
      school: Record<string, unknown>;
      posts: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
    }>(`/schools/${schoolId}/public`, `school_pub:${schoolId}`);
    if (res.success && res.data) setSelectedSchoolPublic(res.data);
  };

  const handleJoinGroup = async (groupId: string) => {
    const res = await apiMutate<{ joined: boolean }>(`/social/groups/${groupId}/join`, 'POST', {});
    if (res.success) loadContent();
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/social/groups', 'POST', { ...groupForm, isPublic: true });
    if (res.success) {
      setGroupForm({ name: '', category: 'Science Club', description: '' });
      loadContent();
    }
  };

  const handleSendConnection = async (recipientUserId: string) => {
    const res = await apiMutate('/social/connections/request', 'POST', { recipientUserId });
    setPostStatus({ ok: res.success, msg: res.message || 'Connection request sent.' });
  };

  const handleRespondConnection = async (connectionId: string, status: 'ACCEPTED' | 'DECLINED') => {
    const res = await apiMutate(`/social/connections/${connectionId}`, 'PATCH', { status });
    if (res.success) loadContent();
  };

  const handleSaveEditPost = async (postId: string) => {
    const res = await apiMutate(`/social/posts/${postId}`, 'PATCH', { content: editingPostContent });
    setPostStatus({ ok: res.success, msg: res.message || 'Post updated.' });
    if (res.success) {
      setEditingPostId(null);
      setEditingPostContent('');
      loadContent();
    }
  };

  const handleDeletePost = async (postId: string) => {
    const res = await apiMutate(`/social/posts/${postId}`, 'DELETE');
    setPostStatus({ ok: res.success, msg: res.message || 'Post deleted.' });
    if (res.success) loadContent();
  };

  const handleBlockUser = async (targetUserId: string) => {
    const res = await apiMutate('/social/blocks', 'POST', { blockedUserId: targetUserId });
    setPostStatus({ ok: res.success, msg: res.message || 'User blocked.' });
    if (res.success) loadContent();
  };

  const handleUnblockUser = async (blockedUserId: string) => {
    const res = await apiMutate(`/social/blocks/${blockedUserId}`, 'DELETE');
    if (res.success) loadContent();
  };

  const handlePinPost = async (postId: string) => {
    const res = await apiMutate<{ isPinned: boolean }>(`/social/posts/${postId}/pin`, 'PATCH', {});
    setPostStatus({ ok: res.success, msg: res.message || 'Updated pin state.' });
    if (res.success) loadContent();
  };

  // ==================== DIRECTORY VIEW ====================
  if (mode === 'directory') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Global School Directory</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Discover verified schools, follow public activities, and collaborate safely
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              placeholder="District (e.g. Kathmandu)"
              aria-label="Filter schools by district"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs min-h-[40px]"
            />
            <input
              type="search"
              value={provinceFilter}
              onChange={(e) => setProvinceFilter(e.target.value)}
              placeholder="Province (e.g. Bagmati)"
              aria-label="Filter schools by province"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs min-h-[40px]"
            />
            <input
              type="search"
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              placeholder="Country (e.g. Nepal)"
              aria-label="Filter schools by country"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs min-h-[40px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {schools.map((sc) => (
            <div key={String(sc.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="h-28 bg-slate-200 dark:bg-slate-800 relative">
                {Boolean(sc.cover_url) && (
                  <img
                    src={String(sc.cover_url)}
                    alt={`${String(sc.name)} campus`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {Boolean(sc.logo_url) && (
                      <img
                        src={String(sc.logo_url)}
                        alt={`${String(sc.name)} crest`}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white"
                      />
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">{String(sc.name)}</h2>
                        <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" aria-label="Verified School" />
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {String(sc.school_code)} · {String(sc.district)}, {String(sc.province)}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{String(sc.about)}</p>
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-mono tabular-nums">
                    {String(sc.followers_count)} followers · {String(sc.public_posts_count)} public posts
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openSchoolProfile(String(sc.id))}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      View Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFollowSchool(String(sc.id))}
                      className={`rounded-lg px-3 py-1.5 font-semibold ${
                        sc.isFollowing
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                          : 'bg-[#0F1E36] dark:bg-blue-600 text-white'
                      }`}
                    >
                      {sc.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Public School Profile Modal */}
        {selectedSchoolPublic && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="h-36 bg-slate-900 relative">
                {Boolean(selectedSchoolPublic.school.cover_url) && (
                  <img
                    src={String(selectedSchoolPublic.school.cover_url)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover opacity-80"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setSelectedSchoolPublic(null)}
                  aria-label="Close school profile"
                  className="absolute top-3 right-3 rounded-lg bg-slate-950/70 p-2 text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <h2 className="text-xl font-bold">{String(selectedSchoolPublic.school.name)}</h2>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>
                      {String(selectedSchoolPublic.school.address)} · {String(selectedSchoolPublic.school.education_board)} · Est.{' '}
                      {String(selectedSchoolPublic.school.established_year)}
                    </span>
                  </p>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{String(selectedSchoolPublic.school.about)}</p>
                <div className="text-xs text-slate-500">
                  Official Contact: {String(selectedSchoolPublic.school.telephone)} · {String(selectedSchoolPublic.school.official_email)}
                </div>
                <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                  <h3 className="text-sm font-bold mb-2">Public Activities ({selectedSchoolPublic.posts.length})</h3>
                  {selectedSchoolPublic.posts.length === 0 ? (
                    <p className="text-xs text-slate-500">No public posts shared yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedSchoolPublic.posts.map((p) => (
                        <div key={String(p.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs">
                          <div className="font-semibold">{String(p.author_name)}</div>
                          <p className="mt-1 text-slate-600 dark:text-slate-300">{String(p.content)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==================== FACEBOOK-INSPIRED PROFILE VIEW ====================
  if (mode === 'profile') {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="h-40 sm:h-52 bg-[#0F1E36] relative">
            <img
              src="/src/assets/images/school_hero_campus_1794923107830.jpg"
              alt="Profile cover"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover opacity-55"
            />
          </div>
          <div className="px-6 pb-5">
            <div className="-mt-10 relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="flex items-end gap-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white dark:border-slate-900 bg-blue-600 text-2xl font-bold text-white shadow-sm">
                  {user.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="pb-1">
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">{user.fullName}</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    @{user.username} · {user.activeRole.replace(/_/g, ' ')}
                    {user.activeSchoolName ? ` · ${user.activeSchoolName}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                <QrCode className="h-4 w-4 text-blue-600" />
                <span>ID: {user.userCode || user.username}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              {(['posts', 'saved', 'groups', 'connections', 'about'] as const).map((tb) => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setProfileTab(tb)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                    profileTab === tb ? 'bg-[#0F1E36] text-white dark:bg-blue-600' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tb}
                </button>
              ))}
            </div>
          </div>
        </div>

        {profileTab === 'posts' && (
          <div className="space-y-4">
            {posts.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500">
                You haven’t published any public posts yet.
              </div>
            ) : (
              posts.map((p) => (
                <div key={String(p.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                  <div className="text-xs text-slate-500">{String(p.audience)} · {formatDateByCalendar(String(p.created_at), calendar)}</div>
                  <p className="mt-2 text-sm">{String(p.content)}</p>
                </div>
              ))
            )}
          </div>
        )}

        {profileTab === 'saved' && (
          <div className="space-y-4">
            {savedPosts.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500">
                No saved posts yet.
              </div>
            ) : (
              savedPosts.map((p) => (
                <div key={String(p.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                  <div className="text-xs font-semibold">{String(p.author_name)} · {String(p.school_name || 'Global')}</div>
                  <p className="mt-1.5 text-sm">{String(p.content)}</p>
                </div>
              ))
            )}
          </div>
        )}

        {profileTab === 'groups' && (
          <div className="space-y-5">
            <form onSubmit={handleCreateGroup} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create Educational Group</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input required placeholder="Group Name (e.g. Grade 10 Math Olympiad)" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                <input required placeholder="Category (e.g. Science Club)" value={groupForm.category} onChange={(e) => setGroupForm({ ...groupForm, category: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
              </div>
              <textarea required rows={2} placeholder="Describe the learning purpose of this moderated group..." value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
              <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Create Study Group</button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map((g) => (
                <div key={String(g.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-cyan-400 font-medium">
                      <Users className="h-3.5 w-3.5" />
                      <span>{String(g.category)}</span>
                      <span>·</span>
                      <span>{String(g.members_count)} members</span>
                    </div>
                    <h3 className="mt-1 text-base font-bold">{String(g.name)}</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{String(g.description)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleJoinGroup(String(g.id))}
                    className={`rounded-lg py-2 text-xs font-semibold ${
                      g.is_member ? 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200' : 'bg-blue-600 text-white'
                    }`}
                  >
                    {g.is_member ? 'Leave Group' : 'Join Educational Group'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {profileTab === 'connections' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Educational Connections</h3>
              {connections.length === 0 ? (
                <p className="text-xs text-slate-500">No peer connections yet. Use &quot;Connect&quot; on posts in the Global Feed to connect with educators and peers.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {connections.map((c) => {
                    const isRecipient = String(c.recipient_user_id) === user.userId;
                    const peerName = isRecipient ? String(c.requester_name) : String(c.recipient_name);
                    return (
                      <div key={String(c.id)} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white">{peerName}</span>
                          <span className="text-slate-500 ml-2 font-mono">{String(c.status)}</span>
                        </div>
                        {isRecipient && String(c.status) === 'PENDING' && (
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => handleRespondConnection(String(c.id), 'ACCEPTED')} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">Accept</button>
                            <button type="button" onClick={() => handleRespondConnection(String(c.id), 'DECLINED')} className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold">Decline</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Blocked Users</h3>
              {blockedUsers.length === 0 ? (
                <p className="text-xs text-slate-500">No users blocked.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {blockedUsers.map((b) => (
                    <div key={String(b.id)} className="py-2 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-900 dark:text-white">
                        {String(b.blocked_name)} (@{String(b.blocked_username)})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUnblockUser(String(b.blocked_user_id))}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {profileTab === 'about' && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-2 text-sm">
            <div><strong>Account Status:</strong> {user.accountStatus}</div>
            <div><strong>Safety Strikes:</strong> <span className="font-mono">{user.strikeCount} / 3</span></div>
            <div><strong>Verified School Memberships:</strong> {user.memberships.length}</div>
            {user.activeRole === 'STUDENT' && (
              <p className="pt-2 text-xs text-slate-500">
                Child safeguarding active: home address, guardian contact, and academic marks are hidden from public profiles.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ==================== GLOBAL FEED & MY SCHOOL FEED ====================
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {mode === 'global_feed' ? <Globe className="h-6 w-6 text-blue-600" /> : <School className="h-6 w-6 text-cyan-600" />}
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {mode === 'global_feed' ? 'Global Education Feed' : `${user.activeSchoolName || 'My School'} Community`}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mode === 'global_feed'
                ? 'Approved public educational projects and announcements across verified schools'
                : 'Private community feed strictly isolated to verified members of your active school'}
            </p>
          </div>
        </div>

        {mode === 'global_feed' && (
          <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {(['ALL', 'FOLLOWING', 'PROJECTS'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFeedFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  feedFilter === f ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {f === 'ALL' ? 'For You' : f === 'FOLLOWING' ? 'Following' : 'Projects'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Universal Post Composer */}
      <form onSubmit={handlePublishPost} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <textarea
          required
          rows={3}
          value={postContent}
          onChange={(e) => setPostContent(e.target.value)}
          placeholder={
            mode === 'my_school'
              ? `Share an update with ${user.activeSchoolName}...`
              : 'Share an educational project, achievement, or resource...'
          }
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-sm focus:border-blue-600 focus:outline-none"
        />

        {uploadedMediaUrl && (
          <div className="relative inline-block">
            <img src={uploadedMediaUrl} alt="Post attachment" className="h-28 rounded-lg object-cover border border-slate-200" />
            <button
              type="button"
              onClick={() => setUploadedMediaUrl(null)}
              aria-label="Remove uploaded image"
              className="absolute -top-2 -right-2 rounded-full bg-slate-900 p-1 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {postStatus && (
          <div className={`text-xs font-medium ${postStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {postStatus.msg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
              <ImagePlus className="h-3.5 w-3.5 text-blue-600" />
              <span>Photo</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadImage(file);
                }}
              />
            </label>
            <select
              value={postType}
              onChange={(e) => setPostType(e.target.value as typeof postType)}
              aria-label="Post type"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="UPDATE">Update</option>
              <option value="PROJECT">Project</option>
              <option value="ACHIEVEMENT">Achievement</option>
              <option value="ANNOUNCEMENT">Announcement</option>
            </select>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as PostAudience)}
              aria-label="Post audience"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              {allowedAudiences.map((aud) => (
                <option key={aud} value={aud}>
                  {aud.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-[#193054] min-h-[38px]"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Publish</span>
          </button>
        </div>
      </form>

      {/* Feed Stream */}
      <div className="space-y-4">
        {posts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
            No posts in this feed yet.
          </div>
        ) : (
          posts.map((p) => (
            <article key={String(p.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  {p.school_logo ? (
                    <img src={String(p.school_logo)} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-xl object-cover border border-slate-200 shrink-0" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shrink-0">
                      {String(p.author_name).charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{String(p.author_name)}</div>
                      {Boolean(p.is_pinned) && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-cyan-400">
                          <Pin className="h-3 w-3" />
                          <span>Pinned</span>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {p.school_name ? `${String(p.school_name)} · ` : ''}
                      {String(p.post_type)} · {String(p.audience).replace(/_/g, ' ')} · {formatDateByCalendar(String(p.created_at), calendar)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 shrink-0">
                  {(['PRINCIPAL', 'VICE_PRINCIPAL', 'PLATFORM_SUPER_ADMIN'].includes(user.activeRole)) && (
                    <button
                      type="button"
                      onClick={() => handlePinPost(String(p.id))}
                      aria-label={p.is_pinned ? 'Unpin post' : 'Pin post'}
                      title={p.is_pinned ? 'Unpin post' : 'Pin announcement'}
                      className={`rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 ${p.is_pinned ? 'text-blue-600 dark:text-cyan-400' : 'text-slate-400 hover:text-blue-600'}`}
                    >
                      {p.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  {String(p.author_user_id) !== user.userId && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSendConnection(String(p.author_user_id))}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Connect
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBlockUser(String(p.author_user_id))}
                        aria-label="Block author"
                        title="Block author"
                        className="rounded-lg p-2 text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {String(p.author_user_id) === user.userId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPostId(String(p.id));
                        setEditingPostContent(String(p.content));
                      }}
                      aria-label="Edit post"
                      className="rounded-lg p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {(String(p.author_user_id) === user.userId ||
                    user.activeRole === 'PRINCIPAL' ||
                    user.activeRole === 'PLATFORM_SUPER_ADMIN') && (
                    <button
                      type="button"
                      onClick={() => handleDeletePost(String(p.id))}
                      aria-label="Delete post"
                      className="rounded-lg p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleReportPost(p)}
                    aria-label="Report post"
                    className="rounded-lg p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {editingPostId === String(p.id) ? (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={editingPostContent}
                    onChange={(e) => setEditingPostContent(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveEditPost(String(p.id))}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Save Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPostId(null)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line">{String(p.content)}</p>
              )}

              {Boolean(p.media_url) && (
                <button
                  type="button"
                  onClick={() => setLightboxImageUrl(String(p.media_url))}
                  className="block w-full text-left"
                >
                  <img
                    src={String(p.media_url)}
                    alt="Post attachment"
                    referrerPolicy="no-referrer"
                    className="w-full max-h-96 rounded-xl object-cover border border-slate-200 dark:border-slate-800 hover:opacity-95 transition-opacity"
                  />
                </button>
              )}

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => handleReact(String(p.id))}
                    className={`inline-flex items-center gap-1.5 font-medium ${p.likedByMe ? 'text-rose-600' : 'hover:text-rose-600'}`}
                  >
                    <Heart className={`h-4 w-4 ${p.likedByMe ? 'fill-rose-600' : ''}`} />
                    <span className="tabular-nums">{String(p.likes_count)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleComments(String(p.id))}
                    className="inline-flex items-center gap-1.5 font-medium hover:text-blue-600"
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span className="tabular-nums">{String(p.comments_count)}</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleSave(String(p.id))}
                  className={`inline-flex items-center gap-1 font-medium ${p.savedByMe ? 'text-blue-600' : 'hover:text-blue-600'}`}
                >
                  <Bookmark className={`h-4 w-4 ${p.savedByMe ? 'fill-blue-600' : ''}`} />
                  <span>{p.savedByMe ? 'Saved' : 'Save'}</span>
                </button>
              </div>

              {openCommentsId === String(p.id) && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="space-y-2">
                    {(commentsMap[String(p.id)] || []).map((c) => (
                      <div key={String(c.id)} className="rounded-lg bg-slate-50 dark:bg-slate-950 p-2.5 text-xs">
                        <span className="font-semibold">{String(c.author_name)}: </span>
                        <span className="text-slate-700 dark:text-slate-300">{String(c.body)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      placeholder="Write a respectful comment..."
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleSendComment(String(p.id))}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>

      {lightboxImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
          onClick={() => setLightboxImageUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImageUrl(null)}
            aria-label="Close image preview"
            className="absolute top-4 right-4 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxImageUrl}
            alt="Expanded post media"
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
