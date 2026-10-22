// Catalog of Nginx directives: where each one may appear, whether it may repeat, and what it needs.
// Used to check custom directives and the generated files. Not exhaustive: unknown directives get a
// warning, never a silent pass.
//
// Contexts: M main, E events, H http, S server, L location, U upstream, I "if" block, X limit_except.
// Flags:   * may repeat in one context   B takes a { } block   R block holds values, not directives
//          P NGINX Plus only   C runs code   D deprecated/removed   mod:<name> needs a module

const TABLE = `
absolute_redirect H S L
accept_mutex E
access_by_lua_block H S L I B C mod:lua
access_log H S L I X *
add_header H S L I *
add_trailer H S L I *
aio H S L
alias L
allow H S L X *
auth_basic H S L X
auth_basic_user_file H S L X
auth_jwt H S L X P
auth_jwt_key_file H S L X * P
auth_request H S L mod:http_auth_request_module
auth_request_set H S L * mod:http_auth_request_module
autoindex H S L
autoindex_exact_size H S L
autoindex_format H S L
autoindex_localtime H S L
body_filter_by_lua_block H S L I B C mod:lua
break S L I
charset H S L I
chunked_transfer_encoding H S L
client_body_buffer_size H S L
client_body_in_file_only H S L
client_body_temp_path H S L
client_body_timeout H S L
client_header_buffer_size H S
client_header_timeout H S
client_max_body_size H S L
content_by_lua L I C mod:lua
content_by_lua_block L I B C mod:lua
daemon M
default_type H S L
deny H S L X *
directio H S L
disable_symlinks H S L
empty_gif L
env M *
error_log M H S L *
error_page H S L I *
etag H S L
events M B
expires H S L I
fastcgi_buffering H S L
fastcgi_buffers H S L
fastcgi_cache H S L
fastcgi_connect_timeout H S L
fastcgi_index H S L
fastcgi_intercept_errors H S L
fastcgi_param H S L *
fastcgi_pass L I
fastcgi_read_timeout H S L
fastcgi_send_timeout H S L
fastcgi_split_path_info L
geo H B R *
grpc_connect_timeout H S L
grpc_pass L I
grpc_read_timeout H S L
grpc_send_timeout H S L
grpc_set_header H S L *
gunzip H S L mod:http_gunzip_module
gzip H S L I
gzip_buffers H S L
gzip_comp_level H S L
gzip_disable H S L
gzip_http_version H S L
gzip_min_length H S L
gzip_proxied H S L
gzip_static H S L mod:http_gzip_static_module
gzip_types H S L
gzip_vary H S L
hash U
header_filter_by_lua_block H S L I B C mod:lua
health_check L P
http M B
http2 H S
http3 H S mod:http_v3_module
if S L B
if_modified_since H S L
ignore_invalid_headers H S
include M E H S L U I X *
index H S L
init_by_lua_block H B C mod:lua
internal L
ip_hash U
js_content L I X C mod:njs
js_import H S L * C mod:njs
js_set H S L * C mod:njs
keepalive U
keepalive_disable H S L
keepalive_requests H S L U
keepalive_time H S L U
keepalive_timeout H S L U
large_client_header_buffers H S
least_conn U
least_time U P
limit_conn H S L *
limit_conn_log_level H S L
limit_conn_status H S L
limit_conn_zone H *
limit_except L B
limit_rate H S L I
limit_rate_after H S L I
limit_req H S L *
limit_req_dry_run H S L
limit_req_log_level H S L
limit_req_status H S L
limit_req_zone H *
listen S *
load_module M *
location S L B *
lock_file M
log_by_lua_block H S L I B C mod:lua
log_format H *
log_not_found H S L
log_subrequest H S L
mail M B
map H B R *
map_hash_bucket_size H
map_hash_max_size H
master_process M
match H B R P
merge_slashes H S
mirror H S L *
mirror_request_body H S L
more_clear_headers H S L I * mod:headers-more
more_set_headers H S L I * mod:headers-more
msie_padding H S L
multi_accept E
ntlm U P
open_file_cache H S L
open_file_cache_errors H S L
open_file_cache_min_uses H S L
open_file_cache_valid H S L
open_log_file_cache H S L
output_buffers H S L
pcre_jit M
perl L I C mod:http_perl_module
perl_set H * C mod:http_perl_module
pid M
port_in_redirect H S L
postpone_output H S L
proxy_bind H S L
proxy_buffer_size H S L
proxy_buffering H S L
proxy_buffers H S L
proxy_busy_buffers_size H S L
proxy_cache H S L
proxy_cache_bypass H S L *
proxy_cache_key H S L
proxy_cache_lock H S L
proxy_cache_methods H S L
proxy_cache_min_uses H S L
proxy_cache_path H *
proxy_cache_revalidate H S L
proxy_cache_use_stale H S L
proxy_cache_valid H S L *
proxy_connect_timeout H S L
proxy_cookie_domain H S L *
proxy_cookie_flags H S L *
proxy_cookie_path H S L *
proxy_force_ranges H S L
proxy_headers_hash_bucket_size H S L
proxy_headers_hash_max_size H S L
proxy_hide_header H S L *
proxy_http_version H S L
proxy_ignore_client_abort H S L
proxy_ignore_headers H S L
proxy_intercept_errors H S L
proxy_max_temp_file_size H S L
proxy_method H S L
proxy_next_upstream H S L
proxy_next_upstream_timeout H S L
proxy_next_upstream_tries H S L
proxy_no_cache H S L *
proxy_pass L I X
proxy_pass_header H S L *
proxy_pass_request_body H S L
proxy_pass_request_headers H S L
proxy_read_timeout H S L
proxy_redirect H S L *
proxy_request_buffering H S L
proxy_send_timeout H S L
proxy_set_body H S L
proxy_set_header H S L *
proxy_socket_keepalive H S L
proxy_ssl_certificate H S L
proxy_ssl_certificate_key H S L
proxy_ssl_ciphers H S L
proxy_ssl_name H S L
proxy_ssl_protocols H S L
proxy_ssl_server_name H S L
proxy_ssl_session_reuse H S L
proxy_ssl_trusted_certificate H S L
proxy_ssl_verify H S L
proxy_ssl_verify_depth H S L
proxy_store H S L
proxy_temp_file_write_size H S L
proxy_temp_path H S L
queue U P
quic_retry H S mod:http_v3_module
random U
real_ip_header H S L mod:http_realip_module
real_ip_recursive H S L mod:http_realip_module
recursive_error_pages H S L
referer_hash_bucket_size S L
request_pool_size H S
reset_timedout_connection H S L
resolver H S L U
resolver_timeout H S L U
return S L I
rewrite S L I *
rewrite_by_lua_block H S L I B C mod:lua
rewrite_log H S L I
root H S L I
satisfy H S L
scgi_param H S L *
scgi_pass L I
secure_link H S L mod:http_secure_link_module
secure_link_md5 H S L mod:http_secure_link_module
secure_link_secret L mod:http_secure_link_module
send_lowat H S L
send_timeout H S L
sendfile H S L I
sendfile_max_chunk H S L
server H U B *
server_name S *
server_name_in_redirect H S L
server_names_hash_bucket_size H
server_names_hash_max_size H
server_tokens H S L
set S L I *
set_by_lua_block S L I B C mod:lua
set_real_ip_from H S L * mod:http_realip_module
slice H S L mod:http_slice_module
split_clients H B R *
ssi H S L I
ssl H S D mod:http_ssl_module
ssl_buffer_size H S mod:http_ssl_module
ssl_certificate H S * mod:http_ssl_module
ssl_certificate_key H S * mod:http_ssl_module
ssl_ciphers H S mod:http_ssl_module
ssl_client_certificate H S mod:http_ssl_module
ssl_conf_command H S * mod:http_ssl_module
ssl_crl H S mod:http_ssl_module
ssl_dhparam H S mod:http_ssl_module
ssl_early_data H S mod:http_ssl_module
ssl_ecdh_curve H S mod:http_ssl_module
ssl_password_file H S mod:http_ssl_module
ssl_prefer_server_ciphers H S mod:http_ssl_module
ssl_protocols H S mod:http_ssl_module
ssl_reject_handshake H S mod:http_ssl_module
ssl_session_cache H S mod:http_ssl_module
ssl_session_ticket_key H S * mod:http_ssl_module
ssl_session_tickets H S mod:http_ssl_module
ssl_session_timeout H S mod:http_ssl_module
ssl_stapling H S mod:http_ssl_module
ssl_stapling_file H S mod:http_ssl_module
ssl_stapling_responder H S mod:http_ssl_module
ssl_stapling_verify H S mod:http_ssl_module
ssl_trusted_certificate H S mod:http_ssl_module
ssl_verify_client H S mod:http_ssl_module
ssl_verify_depth H S mod:http_ssl_module
state U P
sticky U P
stream M B
stub_status S L mod:http_stub_status_module
sub_filter H S L * mod:http_sub_module
sub_filter_once H S L mod:http_sub_module
sub_filter_types H S L mod:http_sub_module
tcp_nodelay H S L
tcp_nopush H S L
thread_pool M *
timer_resolution M
try_files S L
types H S L B R
types_hash_bucket_size H S L
types_hash_max_size H S L
underscores_in_headers H S
uninitialized_variable_warn H S L I
upstream H B *
use E
user M
userid H S L
uwsgi_param H S L *
uwsgi_pass L I
valid_referers S L
variables_hash_bucket_size H
variables_hash_max_size H
worker_connections E
worker_cpu_affinity M
worker_priority M
worker_processes M
worker_rlimit_nofile M
worker_shutdown_timeout M
working_directory M
zone U
`;

export const CONTEXT_NAMES = { M: 'main', E: 'events', H: 'http', S: 'server', L: 'location', U: 'upstream', I: 'if', X: 'limit_except' };
const CONTEXT_CODES = Object.fromEntries(Object.entries(CONTEXT_NAMES).map(([k, v]) => [v, k]));

const CATALOG = new Map();
for (const line of TABLE.trim().split('\n')) {
  const [name, ...rest] = line.trim().split(/\s+/);
  const info = { name, contexts: new Set(), multi: false, block: false, raw: false, plus: false, code: false, deprecated: false, module: null };
  for (const part of rest) {
    if (CONTEXT_NAMES[part]) info.contexts.add(part);
    else if (part === '*') info.multi = true;
    else if (part === 'B') info.block = true;
    else if (part === 'R') info.raw = true;
    else if (part === 'P') info.plus = true;
    else if (part === 'C') info.code = true;
    else if (part === 'D') info.deprecated = true;
    else if (part.startsWith('mod:')) info.module = part.slice(4);
  }
  CATALOG.set(name, info);
}

export function directiveInfo(name) {
  return CATALOG.get(name) || null;
}

/** Whether directive `name` may appear in context ('http', 'server', 'location', 'upstream', 'if', 'limit_except'). */
export function allowedIn(name, context) {
  const info = CATALOG.get(name);
  if (!info) return null; // unknown
  return info.contexts.has(CONTEXT_CODES[context]);
}

export function contextsOf(name) {
  const info = CATALOG.get(name);
  return info ? [...info.contexts].map((c) => CONTEXT_NAMES[c]) : [];
}

/** Child context for a block directive, or null when its body is not made of directives (map, types). */
export function childContext(name) {
  switch (name) {
    case 'server': return 'server';
    case 'location': return 'location';
    case 'if': return 'if';
    case 'limit_except': return 'limit_except';
    case 'upstream': return 'upstream';
    default: return null;
  }
}

export function moduleNote(module) {
  if (!module) return '';
  if (module === 'lua') return 'needs the third-party Lua module (OpenResty / lua-nginx-module)';
  if (module === 'njs') return 'needs the njs dynamic module (ngx_http_js_module)';
  if (module === 'headers-more') return 'needs the third-party headers-more module';
  return `needs ngx_${module} (check that "nginx -V" lists --with-${module})`;
}

export const catalogSize = () => CATALOG.size;
