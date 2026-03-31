# Code Review 指南 - Laravel 最佳实践

## 📋 审查流程

### 1. 预检查（5 分钟）
- [ ] 分支名称规范：`feature/xxx` 或 `bugfix/xxx`
- [ ] PR 描述完整清晰
- [ ] 代码行数合理（< 400 行为佳）
- [ ] 包含测试用例

### 2. 代码质量检查（10-15 分钟）

#### 2.1 架构设计
```php
// ✅ GOOD - 清晰的职责划分
class UserController extends Controller
{
    public function store(StoreUserRequest $request, RegisterUserAction $action)
    {
        $user = $action->execute($request->validated());
        return UserResource::make($user);
    }
}

// ❌ BAD - 业务逻辑混在控制器中
class UserController extends Controller
{
    public function store(StoreUserRequest $request)
    {
        $user = User::create($request->validated());
        $user->profile()->create([...]);
        $user->assignRole('user');
        Mail::send(new WelcomeEmail($user));
        return $user;
    }
}
```

**检查点**:
- 控制器只负责请求/响应处理
- 业务逻辑在 Service/Action 中
- Repository 管理数据持久化
- 单一职责原则

#### 2.2 代码可读性
```php
// ✅ GOOD - 清晰的变量命名和类型提示
public function getActiveUsersByRole(string $role, int $limit = 10): Collection
{
    return User::query()
        ->active()
        ->hasRole($role)
        ->orderByDesc('created_at')
        ->limit($limit)
        ->get();
}

// ❌ BAD - 模糊的变量名和缺失类型提示
public function getUsers($r, $l = 10)
{
    return User::where('active', 1)
        ->where('role', $r)
        ->orderBy('created_at', 'desc')
        ->limit($l)
        ->get();
}
```

**检查点**:
- 变量名自说明
- 类型提示完整
- 注释清晰简洁
- 方法长度 < 20 行

#### 2.3 性能考量
```php
// ✅ GOOD - 避免 N+1 和过度查询
$users = User::with('profile', 'permissions')
    ->where('active', true)
    ->paginate();

// ❌ BAD - N+1 问题
$users = User::where('active', true)->paginate();
foreach ($users as $user) {
    $profile = $user->profile;  // 每行额外查询
}
```

**检查点**:
- 使用 `with()` 预加载关联
- 限制返回字段
- 适当使用缓存
- 数据库索引存在

#### 2.4 错误处理
```php
// ✅ GOOD - 明确的异常处理
public function deleteUser(int $id): void
{
    $user = User::findOrFail($id);
    
    if ($user->has_active_subscriptions) {
        throw new UserHasActiveSubscriptionException('用户有活跃订阅，无法删除');
    }

    $user->delete();
}

// ❌ BAD - 缺少错误处理
public function deleteUser(int $id): void
{
    User::find($id)->delete();
}
```

**检查点**:
- try-catch 适当使用
- 自定义异常有意义
- 错误消息用户友好
- 关键操作有日志记录

#### 2.5 测试覆盖
```php
// ✅ GOOD - 完整的测试
test('user can be activated', function () {
    $user = User::factory()->inactive()->create();
    
    $result = (new UserService())->activateUser($user->id);
    
    expect($result)->toBeTrue()
        ->and($user->refresh()->is_active)->toBeTrue();
});

// ❌ BAD - 缺少测试
// 没有对应的测试用例
```

**检查点**:
- 关键业务逻辑有测试
- 测试覆盖率 > 80%
- 测试名称清晰
- 正常和异常路径都测试

---

## 🎯 常见问题与反馈模板

### 问题 1：N+1 查询
```
💬 「我们在这里发现了 N+1 查询问题」

现象：
- 在 UserController 中循环获取 user->profile 的 bio
- 导致 1 个初始查询 + N 个循环查询

建议：
使用 with() 预加载关联数据：
    $users = User::with('profile')->get();

性能改进：
- 查询次数从 N+1 降至 2 次
- 数据加载时间从 500ms 降至 50ms

参考：https://laravel.com/docs/11.x/eloquent-relationships#eager-loading
```

### 问题 2：方法过长
```
💬 「这个方法做了太多事情，建议拆分」

现象：
- UserService::register() 方法有 50 行代码
- 包含：用户创建、档案创建、邮件发送、日志记录

建议：
创建专用的 Action 类：
    - CreateUserAction （用户创建）
    - CreateUserProfileAction （档案创建）
    - SendWelcomeEmailAction （邮件发送）

然后在 register() 中编排这些 Action

优势：
- 单一职责明确
- 更容易测试
- 可复用性提高
```

### 问题 3：缺少错误处理
```
💬 「需要添加异常处理」

现象：
public function deleteUser($id) {
    User::find($id)->delete();  // 如果不存在会怎样？
}

建议：
public function deleteUser(int $id): void {
    $user = User::findOrFail($id);  // 返回 404
    
    if ($user->has_active_subscriptions) {
        throw new CannotDeleteUserException('用户有活跃订阅');
    }
    
    $user->delete();
}

关键点：
- 使用 findOrFail() 处理不存在的资源
- 创建有意义的自定义异常
- 在异常中提供清晰的错误信息
```

### 问题 4：类型提示缺失
```
💬 「请添加参数和返回类型提示」

现象：
public function formatUserData($user, $options) {
    return $user;  // 返回什么类型？
}

改进：
public function formatUserData(User $user, array $options): array {
    return [
        'id' => $user->id,
        'name' => $user->name,
        'email' => $user->email,
    ];
}

优势：
- IDE 更好的自动完成
- 静态分析工具能检测错误
- 代码更容易维护
```

### 问题 5：缺少测试
```
💬 「请为这个功能编写测试」

示例测试：
test('user email is validated', function () {
    $response = $this->postJson('/api/users', [
        'name' => 'John',
        'email' => 'invalid-email',
    ]);

    $response->assertStatus(422)
        ->assertJsonValidationErrors(['email']);
});
```

---

## ✅ 审查通过的标准

一个 PR 可以合并，当且仅当：

1. **代码质量**
   - ✅ 遵循 PSR-12 规范
   - ✅ 无 PHPStan 警告（level 9）
   - ✅ 测试覆盖率 ≥ 80%

2. **功能完整性**
   - ✅ 功能正常工作
   - ✅ 异常情况处理
   - ✅ 文档已更新

3. **性能与安全**
   - ✅ 没有 N+1 查询
   - ✅ 没有 SQL 注入风险
   - ✅ 敏感信息已隐藏

4. **代码审查**
   - ✅ 至少 1 位资深开发者核准
   - ✅ 所有注释已回复
   - ✅ CI/CD 测试全部通过

---

## 📊 审查反馈统计

### 团队进度追踪
```
周度代码质量指标：

- 平均 PR 审查时间: 24小时
- 首轮反馈率: 85%（大部分 PR 第一轮需要改进）
- 测试覆盖率趋势: ↑ 75% → 88%
- 关键 Bug 数: ↓ 12 → 3

目标：
- 所有新代码覆盖率 > 85%
- 代码质量级别 A+
- 零关键安全漏洞
```

---

## 🎓 审查者的职责

1. **教练心态** - 帮助团队成员成长
2. **明确反馈** - 指出问题、解释为什么、提供改进方案
3. **及时响应** - 24小时内完成审查
4. **持续学习** - 从审查中提炼最佳实践

---

*每月定期组织 Code Review 知识分享会，讨论常见问题与解决方案。*
