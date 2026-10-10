import type { ApiParameter } from '../../../types';

interface ParameterTableProps {
  parameters: ApiParameter[];
}

function locationLabel(loc: string) {
  switch (loc) {
    case 'path':
      return 'Path';
    case 'query':
      return 'Query';
    case 'header':
      return 'Header';
    case 'cookie':
      return 'Cookie';
    default:
      return loc;
  }
}

/**
 * Read-only parameter table shown in view mode.
 * Lists name, location, type, required status, and description for each parameter.
 */
export function ParameterTable({ parameters }: ParameterTableProps) {
  if (parameters.length === 0) {
    return <div className="empty-state">此接口无参数。</div>;
  }

  return (
    <div className="params-table-wrap">
      <table className="params-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>位置</th>
            <th>类型</th>
            <th>必填</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((p) => (
            <tr key={p.id} className={p.deprecated ? 'row--deprecated' : ''}>
              <td>
                <code>{p.name}</code>
                {p.deprecated ? <span className="tag tag--warning">已弃用</span> : null}
              </td>
              <td>
                <span className={`param-loc param-loc--${p.in}`}>{locationLabel(p.in)}</span>
              </td>
              <td>
                <code className="type-text">{p.type ?? '—'}</code>
              </td>
              <td>
                {p.required ? (
                  <span className="required-mark">必需</span>
                ) : (
                  <span className="optional-mark">可选</span>
                )}
              </td>
              <td className="param-desc">
                {p.description ?? '—'}
                {p.example ? (
                  <span className="param-example">
                    示例: <code>{p.example}</code>
                  </span>
                ) : null}
                {p.enum?.length ? (
                  <span className="param-enum">
                    {p.enum.map((v) => (
                      <code key={v}>{v}</code>
                    ))}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
