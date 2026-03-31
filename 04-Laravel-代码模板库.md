# Laravel 代码模板库

**用途**: 直接复制使用，快速开发符合规范的代码。

---

## 📋 模型模板

### 基础 Eloquent 模型
```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Product extends Model
{
    use HasFactory;

    /**
     * 可批量赋值的属性
     */
    protected $fillable = [
        'name',
        'description',
        'price',
        'is_active',
    ];

    /**
     * 自动类型转换
     */
    protected $casts = [
        'price' => 'decimal:2',
        'is_active' => 'boolean',
        'created_at' => 'datetime',
    ];

    /**
     * 产品与订单的关联
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    /**
     * 产品所属分类
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    /**
     * 活跃产品查询作用域
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    /**
     * 价格范围查询作用域
     */
    public function scopePriceRange($query, $min, $max)
    {
        return $query->whereBetween('price', [$min, $max]);
    }
}
```

---

## 🗄️ Repository 模板

### 基础仓储
```php
<?php

namespace App\Repositories;

use App\Models\Product;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator;

final class ProductRepository
{
    /**
     * 获取所有活跃产品
     */
    public function getActive(): Collection
    {
        return Product::active()
            ->with(['category'])
            ->latest()
            ->get();
    }

    /**
     * 分页获取产品列表
     */
    public function paginate(int $perPage = 15, int $page = 1): LengthAwarePaginator
    {
        return Product::query()
            ->with(['category', 'orders'])
            ->orderByDesc('created_at')
            ->paginate($perPage, ['*'], 'page', $page);
    }

    /**
     * 通过 ID 获取产品（优先缓存）
     */
    public function findById(int $id): ?Product
    {
        return cache()->remember(
            "product.{$id}",
            now()->addHours(24),
            fn () => Product::with(['category', 'orders'])->find($id)
        );
    }

    /**
     * 创建新产品
     */
    public function create(array $data): Product
    {
        return Product::create($data);
    }

    /**
     * 更新产品信息
     */
    public function update(int $id, array $data): bool
    {
        $product = Product::findOrFail($id);
        
        $updated = $product->update($data);
        
        if ($updated) {
            cache()->forget("product.{$id}");
        }
        
        return $updated;
    }

    /**
     * 删除产品
     */
    public function delete(int $id): bool
    {
        $product = Product::findOrFail($id);
        
        $deleted = $product->delete();
        
        if ($deleted) {
            cache()->forget("product.{$id}");
        }
        
        return $deleted;
    }

    /**
     * 按分类筛选产品
     */
    public function getByCategory(int $categoryId): Collection
    {
        return Product::where('category_id', $categoryId)
            ->active()
            ->get();
    }

    /**
     * 价格范围内的产品
     */
    public function getByPriceRange(float $min, float $max): Collection
    {
        return Product::priceRange($min, $max)
            ->active()
            ->get();
    }
}
```

---

## 🔧 Service 模板

### 业务逻辑服务
```php
<?php

namespace App\Services;

use App\Repositories\ProductRepository;
use App\Events\ProductCreated;
use App\Exceptions\OutOfStockException;
use Illuminate\Support\Facades\Cache;

final class ProductService
{
    public function __construct(
        private ProductRepository $repository,
    ) {}

    /**
     * 激活产品
     */
    public function activateProduct(int $productId): void
    {
        $product = $this->repository->findById($productId);
        
        if (! $product) {
            throw new \Exception("产品不存在: {$productId}");
        }

        if ($product->is_active) {
            throw new \InvalidArgumentException('产品已激活');
        }

        $product->update(['is_active' => true]);
        
        ProductCreated::dispatch($product);
        
        cache()->forget("product.{$productId}");
    }

    /**
     * 更新产品库存
     */
    public function updateStock(int $productId, int $quantity): void
    {
        $product = $this->repository->findById($productId);
        
        if (! $product) {
            throw new \Exception("产品不存在: {$productId}");
        }

        if ($quantity < 0) {
            throw new \InvalidArgumentException('库存不能为负数');
        }

        $product->update(['stock' => $quantity]);
        cache()->forget("product.{$productId}");
    }

    /**
     * 检查库存是否充足
     */
    public function checkStock(int $productId, int $requiredQuantity): bool
    {
        $product = $this->repository->findById($productId);
        
        return $product && $product->stock >= $requiredQuantity;
    }

    /**
     * 减少库存（用于订单处理）
     */
    public function decreaseStock(int $productId, int $quantity): void
    {
        $product = $this->repository->findById($productId);
        
        if (! $product) {
            throw new \Exception("产品不存在: {$productId}");
        }

        if ($product->stock < $quantity) {
            throw new OutOfStockException('库存不足');
        }

        $product->decrement('stock', $quantity);
        cache()->forget("product.{$productId}");
    }

    /**
     * 增加库存（用于取消订单或退货）
     */
    public function increaseStock(int $productId, int $quantity): void
    {
        $product = $this->repository->findById($productId);
        
        if (! $product) {
            throw new \Exception("产品不存在: {$productId}");
        }

        $product->increment('stock', $quantity);
        cache()->forget("product.{$productId}");
    }
}
```

---

## 🎬 Action 模板

### 复杂操作编排
```php
<?php

namespace App\Actions;

use App\Models\Product;
use App\Services\ProductService;
use App\Services\NotificationService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

final class CreateProductAction
{
    public function __construct(
        private ProductService $productService,
        private NotificationService $notification,
    ) {}

    /**
     * 创建产品并完成相关初始化
     */
    public function execute(array $data): Product
    {
        return DB::transaction(function () use ($data) {
            // 1. 创建产品
            $product = Product::create([
                'name' => $data['name'],
                'description' => $data['description'],
                'price' => $data['price'],
                'category_id' => $data['category_id'],
                'stock' => $data['stock'] ?? 0,
                'is_active' => $data['is_active'] ?? false,
            ]);

            // 2. 设置产品标签
            if (isset($data['tags'])) {
                $product->tags()->sync($data['tags']);
            }

            // 3. 处理产品图片
            if (isset($data['image'])) {
                $this->uploadProductImage($product, $data['image']);
            }

            // 4. 记录日志
            Log::info('产品创建成功', [
                'product_id' => $product->id,
                'name' => $product->name,
            ]);

            // 5. 发送通知
            if ($product->is_active) {
                $this->notification->notifyAdmins('新产品上线', $product);
            }

            return $product;
        });
    }

    /**
     * 上传产品图片
     */
    private function uploadProductImage(Product $product, string $imageData): void
    {
        // 图片上传逻辑
        $path = $imageData; // 实际应上传到存储
        $product->update(['image_url' => $path]);
    }
}
```

---

## 🎮 Controller 模板

### 控制器（精简版）
```php
<?php

namespace App\Http\Controllers;

use App\Actions\CreateProductAction;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Models\Product;
use App\Resources\ProductResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ProductController extends Controller
{
    /**
     * 获取产品列表
     */
    public function index(): AnonymousResourceCollection
    {
        $products = Product::query()
            ->active()
            ->with(['category'])
            ->latest()
            ->paginate();

        return ProductResource::collection($products);
    }

    /**
     * 获取单个产品详情
     */
    public function show(int $id): JsonResponse
    {
        $product = Product::with(['category', 'tags', 'orders'])
            ->findOrFail($id);

        return response()->json([
            'data' => new ProductResource($product),
        ]);
    }

    /**
     * 创建新产品
     */
    public function store(
        StoreProductRequest $request,
        CreateProductAction $action
    ): JsonResponse {
        $product = $action->execute($request->validated());

        return response()->json([
            'data' => new ProductResource($product),
            'message' => '产品创建成功',
        ], 201);
    }

    /**
     * 更新产品
     */
    public function update(
        UpdateProductRequest $request,
        int $id
    ): JsonResponse {
        $product = Product::findOrFail($id);
        $product->update($request->validated());

        return response()->json([
            'data' => new ProductResource($product),
            'message' => '产品更新成功',
        ]);
    }

    /**
     * 删除产品
     */
    public function destroy(int $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json([
            'message' => '产品删除成功',
        ], 204);
    }
}
```

---

## 📝 Form Request 模板

### 表单验证请求
```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductRequest extends FormRequest
{
    /**
     * 验证规则
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
            'price' => ['required', 'numeric', 'min:0'],
            'category_id' => ['required', 'exists:categories,id'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            'tags' => ['array'],
            'tags.*' => ['exists:tags,id'],
            'image' => ['nullable', 'image', 'max:2048'],
        ];
    }

    /**
     * 自定义错误消息
     */
    public function messages(): array
    {
        return [
            'name.required' => '产品名称是必需的',
            'price.required' => '产品价格是必需的',
            'price.min' => '价格不能小于 0',
            'category_id.exists' => '分类不存在',
            'stock.min' => '库存不能为负数',
        ];
    }
}
```

---

## 🧪 测试模板

### Unit 测试（Service）
```php
<?php

use App\Services\ProductService;
use App\Repositories\ProductRepository;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('product can be activated', function () {
    $product = Product::factory()->inactive()->create();
    $repository = app(ProductRepository::class);
    $service = new ProductService($repository);

    $service->activateProduct($product->id);

    expect($product->refresh()->is_active)->toBeTrue();
});

test('cannot activate non-existent product', function () {
    $repository = app(ProductRepository::class);
    $service = new ProductService($repository);

    expect(fn () => $service->activateProduct(999))
        ->toThrow(\Exception::class);
});
```

### Feature 测试（API）
```php
<?php

use App\Models\User;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('products can be listed', function () {
    Product::factory()->count(10)->create();

    $response = $this->getJson('/api/products');

    $response->assertStatus(200)
        ->assertJsonCount(10, 'data');
});

test('product can be created', function () {
    $data = [
        'name' => '测试产品',
        'price' => 99.99,
        'category_id' => 1,
        'is_active' => true,
    ];

    $response = $this->postJson('/api/products', $data);

    $response->assertStatus(201)
        ->assertJsonPath('data.name', '测试产品');

    $this->assertDatabaseHas('products', [
        'name' => '测试产品',
    ]);
});

test('validation errors are returned', function () {
    $response = $this->postJson('/api/products', [
        'name' => '',
    ]);

    $response->assertStatus(422)
        ->assertJsonValidationErrors(['name', 'price']);
});
```

---

## 📦 Job 模板

### 队列任务
```php
<?php

namespace App\Jobs;

use App\Models\User;
use App\Mail\ProductNotificationEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;

final class SendProductNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private User $user,
        private string $message,
    ) {}

    /**
     * 最大的重试次数
     */
    public int $tries = 3;

    /**
     * 任务超时时间（秒）
     */
    public int $timeout = 60;

    public function handle(): void
    {
        Mail::to($this->user->email)
            ->send(new ProductNotificationEmail($this->message));
    }

    /**
     * 任务失败时的处理
     */
    public function failed(\Throwable $exception): void
    {
        \Log::error('发送产品通知失败', [
            'user_id' => $this->user->id,
            'message' => $this->message,
            'error' => $exception->getMessage(),
        ]);
    }
}
```

---

## 🎨 Resource 模板

### API 资源类
```php
<?php

namespace App\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    /**
     * 资源转换为数组
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'price' => (float) $this->price,
            'stock' => $this->stock,
            'is_active' => $this->is_active,
            'category' => new CategoryResource($this->whenLoaded('category')),
            'tags' => TagResource::collection($this->whenLoaded('tags')),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
```

---

## ⚙️ 配置文件模板

### PHP-CS-Fixer
```php
<?php

use PhpCsFixer\Config;
use PhpCsFixer\Finder;

$finder = Finder::create()
    ->in(__DIR__)
    ->exclude(['bootstrap', 'node_modules', 'storage', 'vendor'])
    ->name('*.php')
    ->notName('*.blade.php')
    ->ignoreDotFiles(true)
    ->ignoreVCS(true);

return (new Config())
    ->setRules([
        '@PSR12' => true,
        'array_syntax' => ['syntax' => 'short'],
        'ordered_imports' => ['sort_algorithm' => 'alpha'],
        'no_unused_imports' => true,
        'not_operator_with_successor_space' => true,
        'trailing_comma_in_multiline' => true,
        'phpdoc_scalar' => true,
        'unary_operator_spaces' => true,
        'binary_operator_spaces' => true,
        'blank_line_before_statement' => [
            'statements' => ['break', 'continue', 'declare', 'return', 'throw', 'try'],
        ],
        'phpdoc_single_line_var_spacing' => true,
        'phpdoc_var_without_name' => true,
        'class_attributes_separation' => [
            'elements' => [
                'const' => 'one',
                'method' => 'one',
            ],
        ],
        'method_argument_space' => [
            'on_multiline' => 'ensure_fully_multiline',
            'keep_multiple_spaces_after_comma' => true,
        ],
        'single_trait_insert_per_statement' => true,
    ])
    ->setFinder($finder)
    ->setLineEnding("\n");
```

### PHPStan
```neon
parameters:
    level: 9
    paths:
        - app
    bootstrapFiles:
        - vendor/autoload.php
    ignoreErrors:
        # 忽略特定的错误（如需要）
    checkMissingIterableValueType: false
    checkGenericClassInNonGenericObjectType: false
```

---

## 📦 快速启动脚本

### 项目初始化脚本 (`init-project.sh`)
```bash
#!/bin/bash

echo "🚀 初始化 Laravel 项目..."

# 1. 安装依赖
composer install

# 2. 复制环境配置
cp .env.example .env

# 3. 生成应用密钥
php artisan key:generate

# 4. 运行迁移
php artisan migrate

# 5. 安装开发工具
composer require --dev \
  laravel/pint \
  phpstan/phpstan \
  phpstan/phpstan-laravel \
  nunomaduro/larastan \
  pestphp/pest \
  pestphp/pest-plugin-laravel

# 6. 创建符号链接
php artisan storage:link

# 7. 配置 pre-commit hook
mkdir -p .git/hooks
cp scripts/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

echo "✅ 项目初始化完成！"
echo "运行 'php artisan test' 开始测试"
```

---

*这些模板可以直接复制到你的项目中，符合最佳实践。*
